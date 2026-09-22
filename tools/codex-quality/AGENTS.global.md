# How I Work With Codex

I am a solo developer working on web apps (Next.js/React, Node/TypeScript, Postgres) and Solana/crypto (Anchor, token launches/DeFi, dApp frontends). Optimize for speed on small work and structure only when risk or size justifies it. Use `/spartan:` only when workflow gates matter; otherwise work directly.

## Scope and workflow

- Under 30 minutes and at most 3 files: do it directly.
- Under 1 day: spec → build.
- 1–3 days: spec → plan → build.
- New project or multiple features: epic → spec/plan/build per feature.
- UI work adds a UX prototype before planning.
- TDD for production code: red → green → refactor. Throwaway prototypes are exempt.
- Default auto mode is off. Never skip confirmation for destructive actions.
- At 60% context, compact or checkpoint to `.handoff/` and `.memory/`; project state belongs in files, not only chat.
- Never hand-edit `.planning/`; use the relevant workflow command.

## Judgment and safety

- Be direct and intellectually honest. Push back on weak architecture, security shortcuts, and unvalidated product ideas.
- If ambiguity would materially change the result, name it and ask; do not guess silently.
- Give one recommendation by default. There is no team or ticket tracker.
- Never commit secrets or hardcoded credentials.
- Respect `/spartan:careful`, `/spartan:freeze <dir>`, and `/spartan:guard <dir>` when active.

## Stack defaults

Web: TypeScript, Next.js App Router, React, Tailwind, Node, Postgres. Prefer `pnpm`, `oxlint`, `oxfmt`, Vitest, and `tsc --noEmit`. Map snake_case DB fields to camelCase in application code. Use UUID primary keys, `TEXT`, soft deletes (`deleted_at`), and `TIMESTAMPTZ`. Avoid database FK/CASCADE; enforce relationships in the app.

Solana: Anchor for programs; wallet connect and client-side calls for dApps; prefer `@solana/kit` v7 when practical. Code moving funds is high risk: require tests (Surfpool/LiteSVM/Mollusk), validate every account/PDA, and explicitly review signer, ownership, CPI, reentrancy, arithmetic, and token-interface risks.

Ops: Railway for staging. For production AWS, prefer ECS Fargate, RDS, and Secrets Manager. Do not scaffold cloud infrastructure unless its existence and scope are confirmed.

Product: validate competitors, market signals, and actual user demand before building. Be blunt about weak crypto ideas.

Stack rule packs are opt-in per repo. Copy relevant packs from `~/.Codex/packs/` into the repo's `.Codex/rules/`; do not load them globally.

## Memory and git

Joplin is shared memory. Use `jnote` rather than raw Joplin CLI. For an existing named project notebook, read `jnote cat <project> ideas` at session start; log meaningful work with `jnote log`, and durable decisions with `jnote idea`.

Branches: protected `main`; use short `feature/{slug}` or `fix/{slug}` names.

## Toolchain

- Search with `rg`; find files with `fd`; prefer `ast-grep` for code structure.
- Use `trash`, never recursive-force removal. Run `prek` before commits.
- Python: `uv`, `ruff`, `ty`, `pytest`.
- Rust: `cargo fmt`, `cargo clippy -- -D warnings`, `cargo deny`.
- Bash: `shellcheck`, `shfmt`.
- GitHub Actions: `actionlint`, `zizmor`, and pin actions to full SHAs.
- Look up and pin current stable dependency, runtime, CI action, and tool versions.

## Completion assurance

For tasks that change files, establish the requested outcome, success criteria, scope, and risk before implementation. Keep this lightweight for low-risk work, but do not silently reinterpret ambiguous requirements. Challenge unsafe architecture, missing product evidence, weak tests, and shortcuts directly.

Classify changed work using the repository's `.codex/quality-gates.json` when present:

- Low: documentation and narrowly isolated non-production changes.
- Medium: application behavior, UI, public interfaces, dependencies, tests, or multi-file work.
- High: funds, contracts, authentication, secrets, databases, migrations, deployment/runtime configuration, production operations, or verification infrastructure.

For medium/high-risk changes, after implementation and local checks:

1. Spawn the read-only `quality_reviewer` subagent and ask it to review the current task and final diff.
2. Wait for its verdict. Treat findings as evidence, not suggestions to dismiss.
3. Fix material findings, rerun affected checks, and request a fresh review because any code change invalidates the previous diff fingerprint.
4. Do not describe the work as complete until the independent verdict passes and the Stop hook's deterministic gates pass.

Never treat a skipped, early-returned, unavailable, or unexecuted test as passing coverage. If an external integration prerequisite is unavailable, finish only as blocked unless I explicitly approve a waiver using `approve verification waiver: <gate-id> — <reason>`. Report every waiver in the final response.

Production-affecting commands are separately locked. Request an exact, diff-bound approval using `approve production action: <action-id> — <exact command>` before deployments, broadcasts, on-chain sends, database migrations, or production infrastructure changes. The executed command must match the approved command after shell-token normalization; a different target or later code change invalidates approval.

Implementation handoffs must use `STATUS: COMPLETE` or `STATUS: BLOCKED` and briefly state the reviewer verdict, checks actually run, skipped/unavailable coverage, and approved waivers. This structured status is unnecessary for read-only answers that made no repository changes.
