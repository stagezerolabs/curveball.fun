# Curveball app delivery

This is the default flow for changes to the running app. Complete local verification, push the focused commit to `main`, then deploy the same revision to the VPS at `curveball.fun`. If the user asks for local-only work, stop after the local preview. Contract releases, database migrations, keeper behavior or secrets, and first-time server setup use `deploy/README.md` and their specific runbooks instead of the routine API-only restart below.

## Local Docker preview

1. Keep unrelated working-tree edits untouched. Run the checks relevant to the changed code (for UI: `bun run typecheck` and `bun run build`; for backend: `bun run --cwd services/backend test`; for new calculations: targeted Bun tests). Run `git diff --check`.
2. Use the Makefile to rebuild the local stack after source changes. When the ignored root `.env` targets RISE mainnet (`VITE_CHAIN_ID=4153` and `SOCIAL_CHAIN_ID=4153`), run `make docker-mainnet-rebuild`. It rebuilds `postgres api`, runs the migration job, and leaves the local keeper stopped. Otherwise use `make docker-rebuild` for the configured local network. Do not use `make docker-fresh-testnet` for a normal change; it deletes the local database volume.
3. Check `http://127.0.0.1:5173` for the app and `http://127.0.0.1:8787/health` for the API. Check the affected route or endpoint too. Use `make docker-mainnet-status` and `make docker-mainnet-logs` for local mainnet diagnostics.

## Commit and transfer

The current VPS checkout is `/opt/curveball-mainnet` and is not a Git checkout. The SSH identity is `~/.ssh/fast_shippors_key`; connect as `root@curveball.fun` with `IdentitiesOnly=yes` and `BatchMode=yes`. The server's ignored `deploy/production.env` holds the active `CURVEBALL_RELEASE`, and `RELEASE_REVISION` records the running commit. Production uses `compose.production.yaml` followed by `deploy/compose.mainnet.yaml`.

1. Stage only files belonging to the requested change. Commit with a short imperative summary and push `origin main`. Never include unrelated edits, `.env` files, private keys, or credential-bearing URLs.
2. Read the VPS `RELEASE_REVISION` and `CURVEBALL_RELEASE`; they should agree. Before overwriting a file, compare its server checksum with that file in the recorded Git revision. If the server has drifted, inspect it before copying.
3. Back up the server copies of changed files plus `RELEASE_REVISION` in a mode-`0600` tar under `/opt/curveball-mainnet-release-backups/`. Copy only changed source files using `rsync -rvR` so their relative paths are preserved. Do not sync the whole repository or overwrite production env files. Set copied source ownership to `dot:dot`.

Example transfer (replace the file list with the actual changed files):

```sh
ssh -i ~/.ssh/fast_shippors_key -o IdentitiesOnly=yes -o BatchMode=yes root@curveball.fun \
  'umask 077; mkdir -p /opt/curveball-mainnet-release-backups; cd /opt/curveball-mainnet && tar -cf /opt/curveball-mainnet-release-backups/pre-NEW_RELEASE.tar src/pages/TraderProfilePage.tsx src/style.css RELEASE_REVISION'
rsync -rvR -e "ssh -i $HOME/.ssh/fast_shippors_key -o IdentitiesOnly=yes -o BatchMode=yes" \
  src/pages/TraderProfilePage.tsx src/style.css root@curveball.fun:/opt/curveball-mainnet/
```

Back up only existing files; a newly added file has no previous copy. Record added paths so a source rollback can remove them.

## Build and activate on the VPS

1. In `/opt/curveball-mainnet`, validate production Compose and build the `api` and `keeper` images with `CURVEBALL_RELEASE=<new commit SHA>` set for the command. The keeper image shares the release tag but its running container stays untouched for routine app changes. Capture build output in `/tmp/curveball-build-<SHA>.log` and inspect failures before activating anything.
2. Back up `deploy/production.env` under `/opt/curveball-mainnet-release-backups/` with mode `0600`. Replace only its `CURVEBALL_RELEASE=<old SHA>` line with the new SHA. Preserve ownership `dot:dot` and mode `0600`. Recheck Compose config.
3. Run `docker compose --env-file deploy/production.env -f compose.production.yaml -f deploy/compose.mainnet.yaml up -d --no-deps --force-recreate api`. Do not restart Postgres, keeper, or the edge containers for a routine app change.
4. Wait for `docker inspect --format '{{.State.Health.Status}}' curveball-mainnet-api` to report `healthy`. Only then write the new SHA to `RELEASE_REVISION` (owned by `dot:dot`). If startup or health fails, restore the previous `production.env`, recreate the old `api` image, and restore the source backup/remove newly added files. Report the failed release rather than marking it live.

Use this Compose prefix for config, build, and activation (from the VPS checkout):

```sh
docker compose --env-file deploy/production.env \
  -f compose.production.yaml -f deploy/compose.mainnet.yaml
```

For the build, prefix that command with `CURVEBALL_RELEASE=<new SHA>` while `production.env` still names the old release. Do not regenerate or overwrite the production env files for a routine source deployment.

## Verify and report

- Check `https://curveball.fun`, the affected profile/page route, and `https://social-api.curveball.fun/health` for HTTP 200. Check changed API response fields when applicable.
- Confirm `RELEASE_REVISION`, `CURVEBALL_RELEASE`, and the API container health agree. Confirm the new hashed JS/CSS asset is served by `curveball.fun` when frontend code changed. Remember that `/health` can be healthy even with lagging indexer cursors; inspect freshness when indexing was affected.
- Report what changed, checks run, the live SHA, and any material limitation. Leave unrelated local modifications untouched.

Never run `docker compose down -v` or broad image/volume pruning during this flow. The production Postgres volume contains user-owned social data.
