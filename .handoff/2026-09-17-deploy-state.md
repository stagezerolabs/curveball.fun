# Handoff — 2026-09-17

Navbar, home page and token page redesign is merged to `main` and deployed.
The database is empty because the contracts are not deployed yet, so the site
runs on **demo data** and carries an orange banner saying so. Picking this up
tomorrow is mostly one config step, then switching the demo data off.

## Live now

| Piece | URL / location | State |
|---|---|---|
| Frontend | https://curveball-fun.netlify.app | serving `main` |
| API | https://curveball-kamicash-eb63bc77.koyeb.app | serving `main`, HEALTHY |
| Database | Neon project `curveball` (`gentle-lab-45475868`) | migrated to `0002`, 0 rows |

`netlify.toml` proxies `/api/*` from the Netlify site through to Koyeb, so the
single shareable link above covers the whole stack.

## Demo data — turn this off once real data flows

The deployed site ships sample tokens, trades, holders, candles and launchpad
config so it is presentable to the team before the contracts exist. An orange
banner at the top of every page says the numbers are made up.

It is controlled by one build-time flag, `VITE_DEMO_DATA`, set in
`netlify.toml` under `[build.environment]`. **To remove it: delete that block.**
The next deploy strips every mock from the bundle (about 9 kB) and the banner
disappears with it — `DEMO_DATA` in `src/lib/mockData.ts` gates both.

Two things worth knowing:

- Mocks only ever fill an *empty* API response. Real rows always win, so the
  site will start showing real data on its own as the indexer populates the
  database, before the flag is removed.
- The flag must live in `netlify.toml`, not the workflow. `netlify deploy`
  re-runs the build command itself and discards whatever CI built, so a
  `VITE_DEMO_DATA` set only on the GitHub Actions build step has no effect.

## The one blocker

`/api/config` returns all nulls:

```json
{"quoteSymbol":null,"quoteToken":null,"targetPrice":null,
 "creatorShareBps":null,"treasury":null,"locker":null}
```

The Koyeb service has only `DATABASE_URL`, `DATABASE_SSL`, `PORT`. Without
`LAUNCHPAD_ADDRESS` and `RPC_URL` the server never builds an RPC client
(`hasLaunchpad` is false in `src/server.ts`), so every on-chain-derived field
stays null: `price`, `marketCap`, `progress`, `targetPrice`, the creator/treasury
fee split, and the quote token symbol.

The database-derived endpoints (candles, holders, position, transactions, 24h
volume, holder counts) are wired and return correct empty shapes. They just have
nothing to report until the indexer has something to index.

## Tomorrow, in order

1. **Deploy the contracts.** Note `LAUNCHPAD_ADDRESS` and the RISE RPC URL.

2. **Set them on Koyeb** and let it roll:

   ```sh
   koyeb service update curveball/web \
     --env LAUNCHPAD_ADDRESS=0x... \
     --env RPC_URL=https://...
   ```

   Confirm with `curl -s https://curveball-fun.netlify.app/api/config` — every
   field should be populated. `creatorShareBps` comes from `LpLocker`, so a
   non-null value there proves the whole on-chain read path works. While it is
   null the token page falls back to the demo launchpad config.

3. **Set the same two vars in the frontend build.** `src/lib/web3.js` reads
   `VITE_LAUNCHPAD_ADDRESS` and `VITE_CHAIN_ID` at build time, so they must be
   present when GitHub Actions builds. Add them as repo variables and reference
   them in `.github/workflows/deploy.yml`, or the connect/trade path stays dead
   on the deployed site.

4. **Run the indexer.** `bun run indexer` against the deployed launchpad. It
   backfills from block 0 and stores `block_time` per trade, which is what every
   24h metric reads. Nothing on the page populates until this has run.

   It is not deployed anywhere — currently a local process. Worth deciding
   whether it becomes a second Koyeb service.

5. **Drop the demo data** once the indexer has real rows: delete the
   `[build.environment]` block from `netlify.toml` and push.

6. **Fix the local DATABASE_URL.** Connecting from this machine fails with
   `ECONNRESET` (tried with and without SSL forced). Koyeb connects fine, so it
   is a stale local credential — pull a fresh connection string from the Neon
   console. Until then `bun run dev:api` and the DB-backed tests cannot run
   locally.

## Redeploy mechanics

- **Frontend**: push to `main` → `.github/workflows/deploy.yml` builds and
  publishes to Netlify.
- **API**: `koyeb deploy . curveball/web --archive-builder docker
  --archive-docker-dockerfile Dockerfile`. Not git-connected — it uploads the
  working directory as an archive, so **commit and pull first**, it deploys
  whatever is on disk. The container runs `db:migrate` on boot.
- **Netlify is not git-connected and cannot be**: deploy keys are disabled
  org-wide on `stagezerolabs`, and the GitHub App install needs a browser. The
  Actions workflow exists to work around exactly that.

## Loose ends

- `deployments.local-backup/` in the repo root — your `deployments/` folder.
  The four files differed from the versions tracked on `main`, so they were
  moved aside rather than overwritten during a branch switch. Reconcile or
  delete.
- `neon.ts` is untracked and was left out of commits.
- `NETLIFY_AUTH_TOKEN` in repo secrets is the token from the local Netlify CLI
  config — full account access. Swap for a scoped one if that bothers you.
- Holder counts come from `Trade` events only, so wallet-to-wallet transfers are
  invisible. Indexing ERC20 `Transfer` events into a balances table is the fix
  when it needs to be exact.
- The token page's fee panel calls `LpLocker.claim(pool)` and is enabled for any
  connected wallet, which matches the contract — anyone can call it, and it
  always pays creator and treasury, never the caller. Untested against a real
  pool.

## Behaviour change to be aware of

`price` is now the spot price `vq / vt` rather than the old `realQ / sold`
average cost. The old value lagged the market and was undefined before the first
trade. `marketCap` derives from it, so market caps shift everywhere. If the
numbers look unfamiliar tomorrow, that is why — see `enrichWithMarketData` in
`src/server.ts`.

## Verification state at handoff

`tsc`, `vite build`, `bun test` (3 pass, 2 skip — the DB ones need
`TEST_DATABASE_URL`), `forge build`, `forge test` (21 pass). All seven API
endpoints return 200 directly and through the Netlify proxy.

Not verified: how any of the new UI actually looks. There was no browser
available this session, so the visual pass at 375 / 768 / 1280 is still
outstanding. Most likely to need tuning: the chart at narrow widths and the
trades table overflow on mobile.
