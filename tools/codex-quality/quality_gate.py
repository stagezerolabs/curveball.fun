#!/usr/bin/env python3
"""Risk-tiered Codex lifecycle hook with deterministic completion gates."""

import fnmatch
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path


RISK_ORDER = {"low": 0, "medium": 1, "high": 2}
WAIVER_RE = re.compile(
    r"approve verification waiver:\s*([A-Za-z0-9_.-]+)\s*[—-]\s*(.+)",
    re.IGNORECASE,
)
PRODUCTION_APPROVAL_RE = re.compile(
    r"approve production action:\s*([A-Za-z0-9_.-]+)\s*[—-]\s*(.+)",
    re.IGNORECASE,
)
REVIEW_PREFIX = "QUALITY_REVIEW:"
BYPASS_PATTERNS = (
    (re.compile(r"(?:^|\s)git\s+commit\b[^\n]*(?:--no-verify|-n(?:\s|$))"), "verification bypass"),
    (re.compile(r"(?:^|\s)git\s+push\b[^\n]*(?:--force(?:-with-lease)?|-f(?:\s|$))"), "force push"),
    (re.compile(r"(?:^|\s)git\s+reset\s+--hard\b"), "destructive reset"),
    (re.compile(r"(?:^|\s)git\s+clean\b[^\n]*-[^\s]*f"), "destructive clean"),
    (re.compile(r"(?:^|\s)rm\s+-(?:[^\s]*r[^\s]*f|[^\s]*f[^\s]*r)\b"), "recursive forced removal"),
    (re.compile(r"(?:test|typecheck|build|lint)[^\n]*(?:\|\|\s*true|;\s*true)"), "ignored verification failure"),
)
PRODUCTION_PATTERNS = (
    (re.compile(r"\bforge\b[^\n]*\s--broadcast\b"), "forge-broadcast"),
    (re.compile(r"\bcast\s+send\b"), "cast-send"),
    (re.compile(r"\bmake(?:\s+-C\s+\S+)?\s+deploy-(?:mainnet|testnet|devnet)\b"), "deploy"),
    (re.compile(r"\b(?:drizzle-kit\s+migrate|bun\s+run\s+db:migrate|make\s+migrate)\b"), "database-migration"),
    (re.compile(r"\b(?:terraform\s+(?:apply|destroy)|kubectl\s+(?:apply|delete)|vercel\b[^\n]*--prod|netlify\s+deploy\b[^\n]*--prod)\b"), "production-operation"),
)


def run(command, cwd, timeout=30, env=None):
    return subprocess.run(
        command,
        cwd=str(cwd),
        text=True,
        capture_output=True,
        timeout=timeout,
        env=env,
        check=False,
    )


def git_root(cwd):
    result = run(["git", "rev-parse", "--show-toplevel"], cwd)
    if result.returncode:
        return None
    return Path(result.stdout.strip()).resolve()


def default_profile(warning=None):
    return {
        "version": 1,
        "base_branch": "main",
        "_profile_warning": warning,
        "risk_rules": [
            {
                "level": "high",
                "patterns": [
                    ".codex/**",
                    ".github/**",
                    "**/auth/**",
                    "**/contracts/**",
                    "**/deploy/**",
                    "**/migrations/**",
                    "**/schema.*",
                    "**/*.sol",
                ],
            },
            {
                "level": "medium",
                "patterns": [
                    "**/*.c",
                    "**/*.cpp",
                    "**/*.go",
                    "**/*.java",
                    "**/*.js",
                    "**/*.jsx",
                    "**/*.py",
                    "**/*.rs",
                    "**/*.sh",
                    "**/*.ts",
                    "**/*.tsx",
                    "**/bun.lock",
                    "**/package-lock.json",
                    "**/package.json",
                    "**/pnpm-lock.yaml",
                    "**/yarn.lock",
                    "Cargo.toml",
                    "package.json",
                    "pyproject.toml",
                ],
            },
        ],
        "gates": {
            "always": [
                {"id": "diff-check", "command": ["git", "diff", "--check"], "timeout": 30}
            ],
            "medium": [],
            "high": [],
        },
        "conditional_gates": [],
    }


def profile_is_approved(repo, content):
    configured = os.environ.get("CODEX_QUALITY_PROFILE_REGISTRY")
    registry = Path(configured) if configured else Path.home() / ".codex" / "quality-profiles"
    approval = registry / hashlib.sha256(content).hexdigest()
    if not approval.is_file():
        return False
    try:
        approved_roots = {line.strip() for line in approval.read_text().splitlines() if line.strip()}
    except OSError:
        return False
    return str(repo.resolve()) in approved_roots


def load_profile(repo):
    path = repo / ".codex" / "quality-gates.json"
    if not path.is_file():
        return default_profile()
    content = path.read_bytes()
    if not profile_is_approved(repo, content):
        return default_profile(
            "Ignored unapproved .codex/quality-gates.json; install or approve its exact hash before executable gates can run."
        )
    profile = json.loads(content.decode("utf-8"))
    if profile.get("version") != 1:
        raise ValueError("quality-gates.json must use version 1")
    return profile


def current_branch(repo):
    result = run(["git", "branch", "--show-current"], repo)
    return result.stdout.strip() if result.returncode == 0 else ""


def empty_tree(repo):
    result = subprocess.run(
        ["git", "hash-object", "-w", "-t", "tree", "--stdin"],
        cwd=str(repo),
        input=b"",
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("could not resolve Git empty tree")
    return result.stdout.decode().strip()


def comparison_base(repo, profile, state=None):
    branch = current_branch(repo)
    if branch.startswith(("feature/", "fix/")):
        configured = profile.get("base_branch", "main")
        candidates = [configured, "origin/" + configured]
        for candidate in candidates:
            exists = run(["git", "rev-parse", "--verify", candidate], repo)
            if exists.returncode == 0:
                merged = run(["git", "merge-base", candidate, "HEAD"], repo)
                if merged.returncode == 0:
                    return merged.stdout.strip()
    baseline_commit = (state or {}).get("baseline_commit")
    if isinstance(baseline_commit, str) and baseline_commit:
        exists = run(["git", "rev-parse", "--verify", baseline_commit + "^{tree}"], repo)
        if exists.returncode == 0:
            return baseline_commit
    return "HEAD"


def branch_wide_scope(repo):
    return current_branch(repo).startswith(("feature/", "fix/"))


def raw_changed_files(repo, base):
    result = run(
        ["git", "diff", "--no-renames", "--name-only", "--diff-filter=ACDMRT", base],
        repo,
    )
    paths = set(line for line in result.stdout.splitlines() if line)
    untracked = run(["git", "ls-files", "--others", "--exclude-standard"], repo)
    paths.update(line for line in untracked.stdout.splitlines() if line)
    return sorted(paths)


def committed_changed_files(repo, base):
    result = run(
        [
            "git",
            "diff",
            "--no-renames",
            "--name-only",
            "--diff-filter=ACDMRT",
            base,
            "HEAD",
        ],
        repo,
    )
    return sorted(line for line in result.stdout.splitlines() if line)


def path_state(repo, relative):
    path = repo / relative
    if not path.exists() and not path.is_symlink():
        return "deleted"
    metadata = path.lstat()
    prefix = "%o:" % metadata.st_mode
    if path.is_symlink():
        return prefix + "symlink:" + os.readlink(str(path))
    if not path.is_file():
        return prefix + "non-file"
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return prefix + digest.hexdigest()


def worktree_snapshot(repo):
    return {path: path_state(repo, path) for path in raw_changed_files(repo, "HEAD")}


def changed_files(repo, profile, state=None):
    base = comparison_base(repo, profile, state)
    paths = raw_changed_files(repo, base)
    baseline = (state or {}).get("baseline_snapshot")
    if branch_wide_scope(repo) or not isinstance(baseline, dict):
        return paths
    current = worktree_snapshot(repo)
    candidates = set(paths) | set(baseline)
    worktree_changes = {
        path for path in candidates if baseline.get(path) != current.get(path)
    }
    committed_changes = set(committed_changed_files(repo, base))
    return sorted(worktree_changes | committed_changes)


def diff_fingerprint(repo, profile, state=None):
    return task_fingerprint(repo, profile, state or {})


def task_fingerprint(repo, profile, state):
    digest = hashlib.sha256()
    digest.update(comparison_base(repo, profile, state).encode())
    for relative in changed_files(repo, profile, state):
        digest.update(relative.encode())
        digest.update(path_state(repo, relative).encode())
    return digest.hexdigest()


def matches(path, patterns):
    return any(
        fnmatch.fnmatch(path, pattern)
        or (pattern.startswith("**/") and fnmatch.fnmatch(path, pattern[3:]))
        for pattern in patterns
    )


def classify_risk(paths, profile):
    level = "low"
    for rule in profile.get("risk_rules", []):
        if any(matches(path, rule.get("patterns", [])) for path in paths):
            candidate = rule.get("level", "low")
            if RISK_ORDER.get(candidate, 0) > RISK_ORDER[level]:
                level = candidate
    return level


def selected_gates(paths, risk, profile):
    selected = list(profile.get("gates", {}).get("always", []))
    for level in ("medium", "high"):
        if RISK_ORDER[risk] >= RISK_ORDER[level]:
            selected.extend(profile.get("gates", {}).get(level, []))
    for gate in profile.get("conditional_gates", []):
        if any(matches(path, gate.get("patterns", [])) for path in paths):
            selected.append(gate)
    unique = []
    seen = set()
    for gate in selected:
        gate_id = gate["id"]
        if gate_id not in seen:
            seen.add(gate_id)
            unique.append(gate)
    return unique


def state_root():
    configured = os.environ.get("CODEX_QUALITY_STATE_DIR")
    root = Path(configured) if configured else Path(tempfile.gettempdir()) / "codex-quality-gates"
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        root.chmod(0o700)
    except OSError:
        pass
    return root


def session_key(payload):
    raw = str(payload.get("session_id") or payload.get("conversation_id") or payload.get("turn_id") or "default")
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def state_path(payload):
    return state_root() / (session_key(payload) + ".json")


def read_state(payload):
    path = state_path(payload)
    if not path.is_file():
        return {"waivers": {}, "action_approvals": {}, "review": None, "events": []}
    try:
        with path.open(encoding="utf-8") as handle:
            state = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {"waivers": {}, "action_approvals": {}, "review": None, "events": []}
    state.setdefault("waivers", {})
    state.setdefault("action_approvals", {})
    state.setdefault("review", None)
    state.setdefault("events", [])
    return state


def latest_state_for_repo(repo):
    candidates = []
    for path in state_root().glob("*.json"):
        try:
            with path.open(encoding="utf-8") as handle:
                state = json.load(handle)
            if state.get("repo") == str(repo):
                candidates.append((path.stat().st_mtime_ns, state))
        except (OSError, json.JSONDecodeError):
            continue
    return max(candidates, default=(0, {}), key=lambda item: item[0])[1]


def write_state(payload, state):
    path = state_path(payload)
    temporary = path.with_suffix(".%s.tmp" % os.getpid())
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2, sort_keys=True)
        handle.write("\n")
    temporary.replace(path)


def hook_context(event, text):
    return {
        "hookSpecificOutput": {
            "hookEventName": event,
            "additionalContext": text,
        }
    }


def block_tool(reason):
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "Codex quality gate blocked " + reason + ".",
        }
    }


def blocked_command(command):
    for pattern, reason in BYPASS_PATTERNS:
        if pattern.search(command):
            return reason
    return None


def production_action(command):
    for pattern, action_id in PRODUCTION_PATTERNS:
        if pattern.search(command):
            return action_id
    return None


def normalized_command(command):
    try:
        return shlex.join(shlex.split(command))
    except ValueError:
        return command.strip()


def command_sha(command):
    return hashlib.sha256(normalized_command(command).encode()).hexdigest()


def parse_review(message):
    for line in (message or "").splitlines():
        if line.startswith(REVIEW_PREFIX):
            try:
                value = json.loads(line[len(REVIEW_PREFIX) :].strip())
            except json.JSONDecodeError:
                return None
            if value.get("verdict") not in ("pass", "fail"):
                return None
            if not isinstance(value.get("diff_sha"), str):
                return None
            if not isinstance(value.get("findings", []), list):
                return None
            return value
    return None


def failure_output(reason, payload):
    if payload.get("stop_hook_active") and "STATUS: BLOCKED" in (payload.get("last_assistant_message") or ""):
        return None
    return {"decision": "block", "reason": reason}


def handle_pre_tool_use(payload, repo, profile):
    tool_input = payload.get("tool_input") or {}
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if isinstance(command, str):
        reason = blocked_command(command)
        if reason:
            return block_tool(reason)
        action_id = production_action(command)
        if action_id:
            state = read_state(payload)
            approval = state.get("action_approvals", {}).get(action_id) or {}
            current = task_fingerprint(repo, profile, state) if repo and profile else None
            if (
                not isinstance(approval, dict)
                or approval.get("diff_sha") != current
                or approval.get("command_sha") != command_sha(command)
            ):
                return block_tool(
                    "unapproved production action %s; require `approve production action: %s — <exact command>` for the current diff"
                    % (action_id, action_id)
                )
    return None


def handle_session_start(payload, repo, profile):
    if not repo or not profile:
        return None
    state = read_state(payload)
    needs_anchor = (
        state.get("repo") != str(repo)
        or not state.get("baseline_commit")
        or not isinstance(state.get("baseline_snapshot"), dict)
    )
    if needs_anchor:
        head = run(["git", "rev-parse", "HEAD"], repo)
        state.update(
            {
                "repo": str(repo),
                "branch": current_branch(repo),
                "baseline_commit": head.stdout.strip() if head.returncode == 0 else empty_tree(repo),
                "baseline_snapshot": worktree_snapshot(repo),
            }
        )
        state["baseline_sha"] = diff_fingerprint(repo, profile, state)
    write_state(payload, state)
    context = "Quality gates are active. Medium/high-risk changes require a fresh quality_reviewer verdict and deterministic checks before completion."
    if profile.get("_profile_warning"):
        context += " " + profile["_profile_warning"]
    return hook_context(
        "SessionStart",
        context,
    )


def handle_prompt(payload, repo, profile):
    state = read_state(payload)
    prompt = payload.get("prompt") or payload.get("user_prompt") or ""
    if prompt:
        is_waiver = WAIVER_RE.search(prompt)
        is_action_approval = PRODUCTION_APPROVAL_RE.search(prompt)
        if not is_waiver and not is_action_approval:
            state["objective"] = prompt
            state["waivers"] = {}
            state["action_approvals"] = {}
            state["review"] = None
        for match in WAIVER_RE.finditer(prompt):
            state["waivers"][match.group(1)] = {
                "reason": match.group(2).strip(),
                "diff_sha": task_fingerprint(repo, profile, state) if repo and profile else None,
            }
        for match in PRODUCTION_APPROVAL_RE.finditer(prompt):
            state["action_approvals"][match.group(1)] = {
                "command_sha": command_sha(match.group(2).strip()),
                "diff_sha": task_fingerprint(repo, profile, state) if repo and profile else None,
            }
    write_state(payload, state)
    return hook_context(
        "UserPromptSubmit",
        "Stay within the stated objective. Do not claim completion without risk-matched checks; medium/high-risk code changes also need a fresh independent quality_reviewer pass.",
    )


def handle_subagent_stop(payload, repo, profile):
    if payload.get("agent_type") != "quality_reviewer" or not repo or not profile:
        return None
    review = parse_review(payload.get("last_assistant_message"))
    if review is None:
        return {
            "decision": "block",
            "reason": "Return one final line as QUALITY_REVIEW: followed by valid JSON with verdict, diff_sha, and findings.",
        }
    state = read_state(payload)
    current = diff_fingerprint(repo, profile, state)
    if review["diff_sha"] != current:
        return {
            "decision": "block",
            "reason": "Re-review the current diff and report its current fingerprint; the supplied diff_sha is stale.",
        }
    state["review"] = review
    state["review"]["task_sha"] = task_fingerprint(repo, profile, state)
    write_state(payload, state)
    return None


def gate_failures(repo, paths, risk, profile, waivers, current_sha, state):
    failures = []
    for gate in selected_gates(paths, risk, profile):
        gate_id = gate["id"]
        missing = [name for name in gate.get("required_env", []) if not os.environ.get(name, "").strip()]
        if missing:
            waiver = waivers.get(gate_id) or {}
            if not isinstance(waiver, dict) or waiver.get("diff_sha") != current_sha:
                failures.append(
                    "%s requires environment variable(s) %s; run it or obtain an explicit waiver"
                    % (gate_id, ", ".join(missing))
                )
            continue
        command = gate.get("command")
        if not isinstance(command, list) or not command:
            failures.append(gate_id + " has an invalid command definition")
            continue
        if command[:3] == ["git", "diff", "--check"]:
            command = command + [comparison_base(repo, profile, state), "--"] + paths
        try:
            result = run(command, repo, int(gate.get("timeout", 600)), os.environ.copy())
        except subprocess.TimeoutExpired:
            failures.append("%s timed out" % gate_id)
            continue
        except OSError as error:
            failures.append("%s could not start: %s" % (gate_id, error.strerror or type(error).__name__))
            continue
        if result.returncode:
            detail = (result.stderr or result.stdout).strip()
            if len(detail) > 1200:
                detail = detail[-1200:]
            failures.append("%s failed (exit %s): %s" % (gate_id, result.returncode, detail))
            continue
        if gate_id == "diff-check":
            untracked = set(
                line
                for line in run(["git", "ls-files", "--others", "--exclude-standard"], repo).stdout.splitlines()
                if line
            )
            whitespace_errors = []
            for relative in paths:
                if relative not in untracked:
                    continue
                path = repo / relative
                if not path.is_file():
                    continue
                data = path.read_bytes()
                if b"\x00" in data:
                    continue
                for number, line in enumerate(data.splitlines(keepends=True), 1):
                    content = line.rstrip(b"\r\n")
                    if content.endswith((b" ", b"\t")) or content.startswith((b"<<<<<<<", b">>>>>>>")):
                        whitespace_errors.append("%s:%s" % (relative, number))
            if whitespace_errors:
                failures.append("diff-check failed for untracked file(s): " + ", ".join(whitespace_errors))
    return failures


def handle_stop(payload, repo, profile):
    if not repo or not profile:
        return None
    state = read_state(payload)
    paths = changed_files(repo, profile, state)
    if not paths:
        return None
    risk = classify_risk(paths, profile)
    current = task_fingerprint(repo, profile, state)
    if RISK_ORDER[risk] >= RISK_ORDER["medium"]:
        review = state.get("review") or {}
        if review.get("task_sha") != current:
            return failure_output(
                "Risk is %s. Spawn the read-only quality_reviewer, have it review the current diff, and address its findings before completing." % risk,
                payload,
            )
        if review.get("verdict") != "pass":
            return failure_output(
                "The quality_reviewer did not pass the current diff. Resolve its findings and request a new review.",
                payload,
            )
    failures = gate_failures(
        repo,
        paths,
        risk,
        profile,
        state.get("waivers", {}),
        current,
        state,
    )
    if failures:
        return failure_output("Verification gates failed:\n- " + "\n- ".join(failures), payload)
    state["last_verified_sha"] = current
    state["last_verified_risk"] = risk
    write_state(payload, state)
    return None


def handle_compact(event, payload):
    state = read_state(payload)
    objective = state.get("objective", "the current user request")
    review = state.get("review") or {}
    status = "current" if review else "missing"
    return hook_context(
        event,
        "Restore task focus: objective=%r. Independent review status=%s. Re-run required verification after any code change."
        % (objective[:500], status),
    )


def read_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def emit(output):
    if output is not None:
        sys.stdout.write(json.dumps(output, separators=(",", ":")))


def dispatch(event):
    cwd = Path.cwd()
    repo = git_root(cwd)
    profile = load_profile(repo) if repo else None
    if event == "fingerprint":
        if not repo or not profile:
            raise SystemExit("not inside a Git repository")
        state = latest_state_for_repo(repo)
        print(diff_fingerprint(repo, profile, state))
        return
    if event == "review_base":
        if not repo or not profile:
            raise SystemExit("not inside a Git repository")
        state = latest_state_for_repo(repo)
        print(comparison_base(repo, profile, state))
        return
    payload = read_payload()
    if event == "pre_tool_use":
        emit(handle_pre_tool_use(payload, repo, profile))
    elif event == "session_start":
        emit(handle_session_start(payload, repo, profile))
    elif event == "user_prompt_submit":
        emit(handle_prompt(payload, repo, profile))
    elif event == "subagent_stop":
        emit(handle_subagent_stop(payload, repo, profile))
    elif event == "stop":
        emit(handle_stop(payload, repo, profile))
    elif event in ("pre_compact", "post_compact"):
        emit(handle_compact("PreCompact" if event == "pre_compact" else "PostCompact", payload))
    elif event == "post_tool_use":
        state = read_state(payload)
        tool_input = payload.get("tool_input") or {}
        tool_response = payload.get("tool_response") or payload.get("tool_output") or {}
        event_record = {
            "tool": payload.get("tool_name", "unknown"),
            "input_sha": hashlib.sha256(json.dumps(tool_input, sort_keys=True, default=str).encode()).hexdigest(),
            "exit_code": tool_response.get("exit_code") if isinstance(tool_response, dict) else None,
            "diff_sha": task_fingerprint(repo, profile, state) if repo and profile else None,
        }
        state["events"] = (state.get("events", []) + [event_record])[-100:]
        write_state(payload, state)
    elif event == "session_end":
        path = state_path(payload)
        if path.exists():
            path.unlink()
    else:
        raise SystemExit("unknown event: " + event)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: quality_gate.py <event|fingerprint|review_base>")
    event = sys.argv[1]
    try:
        dispatch(event)
    except Exception as error:
        if event == "fingerprint":
            raise
        reason = "Codex quality gate internal error (%s); fail closed and repair the hook before continuing." % type(error).__name__
        if event == "pre_tool_use":
            emit(block_tool(reason))
        elif event in ("stop", "subagent_stop"):
            emit({"decision": "block", "reason": reason})
        else:
            emit({"systemMessage": reason})


if __name__ == "__main__":
    main()
