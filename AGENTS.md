# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the React/Vite app; `public/` holds assets. The Bun/Fastify backend in `services/backend/src/` serves the app and API. Database schema and migrations are in `packages/db/`; the keeper is in `keeper/`. Solidity code and Foundry tests are in `contracts/`. Deployment records are in `deployments/`, operations in `deploy/`, and notes in `docs/`.

## Docker, Build & Development Commands

The local runtime is `compose.yaml`: `postgres`, one `api` container serving the app, API, and indexer, plus `keeper`. A `migrate` job precedes `api`. Copy `.env.example` to root `.env` and fill in chain, Privy, and keeper values.

- `make docker-setup`: validate Compose, build, and start the stack. The app is at `http://127.0.0.1:5173`; API health is at `http://127.0.0.1:8787/health`. Both reach `api`.
- `make docker-rebuild`: rebuild after source changes. `make docker-up` starts existing images; `make docker-down` stops them.
- `make docker-status` and `make docker-logs`: inspect containers and follow logs.
- `make docker-mainnet-up`: start only Postgres and API when the root `.env` targets RISE mainnet; the keeper stays stopped.
- `bun run build`: build the frontend; `bun run typecheck` checks TypeScript. `bun run dev` starts a standalone Vite frontend for isolated UI work.

`make docker-fresh-testnet` deletes the local Postgres volume. See `README.md` for deployment.

## Coding Style & Naming Conventions

Use two-space indentation and double-quoted imports in TypeScript/JavaScript; use four spaces in Solidity. Name React components and contracts in PascalCase, functions and variables in camelCase. No repository-wide formatter or lint command is configured; match neighboring files.

## Testing Guidelines

Frontend Bun tests sit beside modules as `*.test.ts(x)` or `*.test.js`; backend and keeper tests live in `tests/` and `test/`. Contract tests use Foundry `*.t.sol` under `contracts/test/`; fork tests are in `contracts/test/fork/`. Run `make test` for type checking, Bun tests, and non-fork Foundry tests. Use `bun run --cwd services/backend test`, `bun run --cwd keeper test`, or `make -C contracts test-fork-strict` for affected areas. No coverage threshold is configured.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries (for example, `Simplify token launch form and preview`); older ones sometimes use `feat:` or `fix:`. Keep commits focused. Pull requests should summarize changes, list checks run, link relevant issues, and include screenshots for UI changes. Note affected networks or migrations.

## Security & Configuration

Never commit private keys, seed phrases, keystore passwords, or credential-bearing RPC URLs. Keep secrets in the ignored `.env`; do not put them in public `VITE_` variables.
