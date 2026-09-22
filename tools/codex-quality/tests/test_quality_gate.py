import json
import hashlib
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "quality_gate.py"


class QualityGateHookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name) / "repo"
        self.state = Path(self.temp.name) / "state"
        self.registry = Path(self.temp.name) / "registry"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.repo, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=self.repo, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=self.repo, check=True)
        (self.repo / "README.md").write_text("baseline\n")
        subprocess.run(["git", "add", "README.md"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "baseline"], cwd=self.repo, check=True)
        (self.repo / ".codex").mkdir()
        self.profile_path = self.repo / ".codex" / "quality-gates.json"
        self.profile_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "base_branch": "main",
                    "risk_rules": [
                        {"level": "high", "patterns": ["contracts/**"]},
                        {"level": "medium", "patterns": ["src/**"]},
                    ],
                    "gates": {
                        "always": [
                            {
                                "id": "diff-check",
                                "command": ["git", "diff", "--check"],
                                "timeout": 10,
                            }
                        ],
                        "medium": [
                            {
                                "id": "unit",
                                "command": ["python3", "-c", "raise SystemExit(0)"],
                                "timeout": 10,
                            }
                        ],
                        "high": [],
                    },
                    "conditional_gates": [
                        {
                            "id": "fork",
                            "patterns": ["contracts/**"],
                            "command": ["python3", "-c", "raise SystemExit(0)"],
                            "required_env": ["TEST_RPC_URL"],
                            "timeout": 10,
                        }
                    ],
                }
            )
        )
        self.approve_profile()

    def tearDown(self):
        self.temp.cleanup()

    def run_hook(self, event, payload, extra_env=None):
        env = os.environ.copy()
        env["CODEX_QUALITY_STATE_DIR"] = str(self.state)
        env["CODEX_QUALITY_PROFILE_REGISTRY"] = str(self.registry)
        if extra_env:
            env.update(extra_env)
        return subprocess.run(
            ["python3", str(HOOK), event],
            cwd=self.repo,
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )

    def fingerprint(self):
        env = os.environ.copy()
        env["CODEX_QUALITY_PROFILE_REGISTRY"] = str(self.registry)
        env["CODEX_QUALITY_STATE_DIR"] = str(self.state)
        result = subprocess.run(
            ["python3", str(HOOK), "fingerprint"],
            cwd=self.repo,
            text=True,
            capture_output=True,
            env=env,
            check=True,
        )
        return result.stdout.strip()

    def approve_profile(self):
        self.registry.mkdir(exist_ok=True)
        digest = hashlib.sha256(self.profile_path.read_bytes()).hexdigest()
        (self.registry / digest).write_text(str(self.repo.resolve()) + "\n")

    def make_repo_unborn(self):
        subprocess.run(["git", "checkout", "--orphan", "unborn", "-q"], cwd=self.repo, check=True)
        subprocess.run(["git", "read-tree", "--empty"], cwd=self.repo, check=True)
        (self.repo / "README.md").unlink()

    def record_passing_review(self, session_id="session-1"):
        review = {
            "verdict": "pass",
            "diff_sha": self.fingerprint(),
            "findings": [],
        }
        result = self.run_hook(
            "subagent_stop",
            {
                "session_id": session_id,
                "agent_type": "quality_reviewer",
                "last_assistant_message": f"QUALITY_REVIEW: {json.dumps(review)}",
            },
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_pre_tool_use_denies_verification_bypass(self):
        result = self.run_hook(
            "pre_tool_use",
            {
                "session_id": "session-1",
                "tool_name": "Bash",
                "tool_input": {"command": "git commit --no-verify -m shortcut"},
            },
        )
        output = json.loads(result.stdout)
        self.assertEqual(
            output["hookSpecificOutput"]["permissionDecision"], "deny"
        )
        self.assertIn("verification bypass", output["hookSpecificOutput"]["permissionDecisionReason"])

    def test_production_action_requires_diff_bound_explicit_approval(self):
        payload = {
            "session_id": "session-1",
            "tool_name": "Bash",
            "tool_input": {"command": "forge script Deploy --broadcast"},
        }
        blocked = self.run_hook("pre_tool_use", payload)
        self.assertEqual(
            json.loads(blocked.stdout)["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

        self.run_hook(
            "user_prompt_submit",
            {
                "session_id": "session-1",
                "prompt": "approve production action: forge-broadcast — forge script Deploy --broadcast",
            },
        )
        allowed = self.run_hook("pre_tool_use", payload)
        self.assertEqual(allowed.stdout, "")

        different = dict(payload)
        different["tool_input"] = {"command": "forge script DeployMainnet --broadcast"}
        wrong_target = self.run_hook("pre_tool_use", different)
        self.assertEqual(
            json.loads(wrong_target.stdout)["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

        (self.repo / "README.md").write_text("changed after approval\n")
        stale = self.run_hook("pre_tool_use", payload)
        self.assertEqual(
            json.loads(stale.stdout)["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

    def test_medium_change_cannot_stop_without_independent_review(self):
        (self.repo / "src").mkdir()
        (self.repo / "src" / "app.ts").write_text("export const value = 1;\n")
        result = self.run_hook("stop", {"session_id": "session-1"})
        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_unprofiled_repository_still_requires_review_for_source_changes(self):
        (self.repo / ".codex" / "quality-gates.json").unlink()
        (self.repo / "src").mkdir()
        (self.repo / "src" / "app.py").write_text("VALUE = 1\n")
        result = self.run_hook("stop", {"session_id": "session-1"})
        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_main_branch_ignores_unchanged_preexisting_dirty_files(self):
        (self.repo / "src").mkdir()
        (self.repo / "src" / "preexisting.ts").write_text("export const old = true;\n")
        started = self.run_hook("session_start", {"session_id": "session-1"})
        self.assertEqual(started.returncode, 0, started.stderr)
        (self.repo / "README.md").write_text("docs-only task\n")

        stopped = self.run_hook("stop", {"session_id": "session-1"})

        self.assertEqual(stopped.returncode, 0, stopped.stderr)
        self.assertEqual(stopped.stdout, "")

    def test_reverting_a_preexisting_dirty_file_is_still_in_task_scope(self):
        (self.repo / "src").mkdir()
        app = self.repo / "src" / "app.ts"
        app.write_text("export const value = 1;\n")
        subprocess.run(["git", "add", "src/app.ts"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "add app"], cwd=self.repo, check=True)
        app.write_text("export const preexisting = true;\n")
        self.run_hook("session_start", {"session_id": "session-1"})
        app.write_text("export const value = 1;\n")

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_deleting_a_clean_tracked_source_file_requires_review(self):
        (self.repo / "src").mkdir()
        app = self.repo / "src" / "deleted.ts"
        app.write_text("export const removed = true;\n")
        subprocess.run(["git", "add", "src/deleted.ts"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "add deletable source"], cwd=self.repo, check=True)
        self.run_hook("session_start", {"session_id": "session-1"})
        app.unlink()

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_committed_main_branch_change_requires_review(self):
        self.run_hook("session_start", {"session_id": "session-1"})
        (self.repo / "src").mkdir()
        (self.repo / "src" / "committed.ts").write_text("export const committed = true;\n")
        subprocess.run(["git", "add", "src/committed.ts"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "commit task change"], cwd=self.repo, check=True)

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_committed_detached_head_change_requires_review(self):
        subprocess.run(["git", "checkout", "--detach", "-q"], cwd=self.repo, check=True)
        self.run_hook("session_start", {"session_id": "session-1"})
        (self.repo / "src").mkdir()
        (self.repo / "src" / "detached.ts").write_text("export const detached = true;\n")
        subprocess.run(["git", "add", "src/detached.ts"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "detached task change"], cwd=self.repo, check=True)

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_committed_change_can_pass_only_after_matching_review(self):
        self.run_hook("session_start", {"session_id": "session-1"})
        (self.repo / "src").mkdir()
        (self.repo / "src" / "reviewed.ts").write_text("export const reviewed = true;\n")
        subprocess.run(["git", "add", "src/reviewed.ts"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "reviewed task change"], cwd=self.repo, check=True)

        self.record_passing_review()
        result = self.run_hook("stop", {"session_id": "session-1"})

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_staged_high_risk_rename_to_docs_still_requires_review(self):
        (self.repo / "contracts").mkdir()
        source = self.repo / "contracts" / "Funds.sol"
        source.write_text("contract Funds {}\n")
        subprocess.run(["git", "add", "contracts/Funds.sol"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "add high risk source"], cwd=self.repo, check=True)
        self.run_hook("session_start", {"session_id": "session-1"})
        (self.repo / "docs").mkdir()
        subprocess.run(
            ["git", "mv", "contracts/Funds.sol", "docs/Funds.txt"],
            cwd=self.repo,
            check=True,
        )

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_committed_high_risk_rename_to_docs_still_requires_review(self):
        (self.repo / "contracts").mkdir()
        source = self.repo / "contracts" / "Funds.sol"
        source.write_text("contract Funds {}\n")
        subprocess.run(["git", "add", "contracts/Funds.sol"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "add high risk source"], cwd=self.repo, check=True)
        self.run_hook("session_start", {"session_id": "session-1"})
        (self.repo / "docs").mkdir()
        subprocess.run(
            ["git", "mv", "contracts/Funds.sol", "docs/Funds.txt"],
            cwd=self.repo,
            check=True,
        )
        subprocess.run(["git", "commit", "-qm", "move high risk source"], cwd=self.repo, check=True)

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_compact_session_start_preserves_committed_task_anchor(self):
        self.run_hook(
            "session_start",
            {"session_id": "session-1", "source": "startup"},
        )
        (self.repo / "src").mkdir()
        (self.repo / "src" / "compact.ts").write_text("export const compact = true;\n")
        subprocess.run(["git", "add", "src/compact.ts"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "task before compact"], cwd=self.repo, check=True)
        self.run_hook(
            "session_start",
            {"session_id": "session-1", "source": "compact"},
        )

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_resume_session_start_preserves_uncommitted_task_anchor(self):
        self.run_hook(
            "session_start",
            {"session_id": "session-1", "source": "startup"},
        )
        (self.repo / "src").mkdir()
        (self.repo / "src" / "resume.ts").write_text("export const resume = true;\n")
        self.run_hook(
            "session_start",
            {"session_id": "session-1", "source": "resume"},
        )

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_unborn_repo_uncommitted_source_requires_review(self):
        self.make_repo_unborn()
        started = self.run_hook("session_start", {"session_id": "session-1", "source": "startup"})
        self.assertIn("Quality gates are active", started.stdout)
        state = json.loads(next(self.state.glob("*.json")).read_text())
        baseline = state["baseline_commit"]
        baseline_check = subprocess.run(
            ["git", "rev-parse", "--verify", baseline + "^{tree}"],
            cwd=self.repo,
            text=True,
            capture_output=True,
        )
        self.assertEqual(baseline_check.returncode, 0, baseline_check.stderr)
        (self.repo / "src").mkdir()
        (self.repo / "src" / "app.py").write_text("VALUE = 1\n")

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_unborn_repo_first_commit_requires_review(self):
        self.make_repo_unborn()
        self.run_hook("session_start", {"session_id": "session-1", "source": "startup"})
        (self.repo / "src").mkdir()
        (self.repo / "src" / "app.py").write_text("VALUE = 1\n")
        subprocess.run(["git", "add", "src/app.py"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "first task commit"], cwd=self.repo, check=True)

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_unborn_repo_first_commit_survives_compaction(self):
        self.make_repo_unborn()
        self.run_hook("session_start", {"session_id": "session-1", "source": "startup"})
        (self.repo / "src").mkdir()
        (self.repo / "src" / "app.py").write_text("VALUE = 1\n")
        subprocess.run(["git", "add", "src/app.py"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "first task commit"], cwd=self.repo, check=True)
        self.run_hook("session_start", {"session_id": "session-1", "source": "compact"})

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_file_mode_change_invalidates_a_review(self):
        (self.repo / "src").mkdir()
        app = self.repo / "src" / "app.py"
        app.write_text("print('safe')\n")
        self.record_passing_review()
        app.chmod(0o755)

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("current diff", output["reason"])

    def test_diff_check_includes_committed_feature_branch_changes(self):
        subprocess.run(["git", "checkout", "-qb", "feature/whitespace"], cwd=self.repo, check=True)
        (self.repo / "README.md").write_text("trailing whitespace   \n")
        subprocess.run(["git", "add", "README.md"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "bad whitespace"], cwd=self.repo, check=True)

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("diff-check", output["reason"])

    def test_diff_check_includes_untracked_files(self):
        self.run_hook("session_start", {"session_id": "session-1"})
        (self.repo / "NOTES.md").write_text("trailing whitespace   \n")

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("diff-check", output["reason"])

    def test_unprofiled_nested_lockfile_requires_review(self):
        self.profile_path.unlink()
        self.run_hook("session_start", {"session_id": "session-1"})
        (self.repo / "web").mkdir()
        (self.repo / "web" / "pnpm-lock.yaml").write_text("lockfileVersion: '9'\n")

        result = self.run_hook("stop", {"session_id": "session-1"})

        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("quality_reviewer", output["reason"])

    def test_tampered_repository_profile_cannot_execute_unapproved_commands(self):
        marker = Path(self.temp.name) / "executed"
        profile = json.loads(self.profile_path.read_text())
        profile["gates"]["always"] = [
            {
                "id": "malicious",
                "command": ["python3", "-c", f"from pathlib import Path; Path({str(marker)!r}).touch()"],
                "timeout": 10,
            }
        ]
        self.profile_path.write_text(json.dumps(profile))
        self.record_passing_review()

        result = self.run_hook("stop", {"session_id": "session-1"})

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(marker.exists())

    def test_missing_gate_executable_blocks_instead_of_failing_open(self):
        profile = json.loads(self.profile_path.read_text())
        profile["gates"]["always"] = [
            {
                "id": "missing-tool",
                "command": ["definitely-not-a-real-quality-tool"],
                "timeout": 10,
            }
        ]
        self.profile_path.write_text(json.dumps(profile))
        self.approve_profile()
        (self.repo / "README.md").write_text("changed\n")

        result = self.run_hook("stop", {"session_id": "session-1"})

        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("missing-tool", output["reason"])

    def test_stale_review_is_rejected_after_the_diff_changes(self):
        (self.repo / "src").mkdir()
        app = self.repo / "src" / "app.ts"
        app.write_text("export const value = 1;\n")
        self.record_passing_review()
        app.write_text("export const value = 2;\n")
        result = self.run_hook("stop", {"session_id": "session-1"})
        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("current diff", output["reason"])

    def test_matching_review_and_passing_checks_allow_completion(self):
        (self.repo / "src").mkdir()
        (self.repo / "src" / "app.ts").write_text("export const value = 1;\n")
        self.record_passing_review()
        result = self.run_hook("stop", {"session_id": "session-1"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_external_gate_needs_an_explicit_waiver_when_env_is_missing(self):
        (self.repo / "contracts").mkdir()
        (self.repo / "contracts" / "Funds.sol").write_text("contract Funds {}\n")
        self.record_passing_review()
        blocked = self.run_hook("stop", {"session_id": "session-1"})
        self.assertIn("TEST_RPC_URL", json.loads(blocked.stdout)["reason"])

        waiver = self.run_hook(
            "user_prompt_submit",
            {
                "session_id": "session-1",
                "prompt": "approve verification waiver: fork — RPC is unavailable today",
            },
        )
        self.assertEqual(waiver.returncode, 0, waiver.stderr)
        allowed = self.run_hook("stop", {"session_id": "session-1"})
        self.assertEqual(allowed.returncode, 0, allowed.stderr)
        self.assertEqual(allowed.stdout, "")

        self.run_hook(
            "user_prompt_submit",
            {"session_id": "session-1", "prompt": "Start a different task now"},
        )
        self.record_passing_review()
        reset = self.run_hook("stop", {"session_id": "session-1"})
        self.assertIn("TEST_RPC_URL", json.loads(reset.stdout)["reason"])

        self.run_hook(
            "user_prompt_submit",
            {
                "session_id": "session-1",
                "prompt": "approve verification waiver: fork — RPC is unavailable today",
            },
        )

        (self.repo / "contracts" / "Funds.sol").write_text("contract Funds { uint value; }\n")
        self.record_passing_review()
        stale = self.run_hook("stop", {"session_id": "session-1"})
        self.assertIn("TEST_RPC_URL", json.loads(stale.stdout)["reason"])


if __name__ == "__main__":
    unittest.main()
