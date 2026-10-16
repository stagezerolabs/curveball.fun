# Graduation keeper

A standalone Node.js worker for the active Curveball factory. It discovers launches, watches curves, and submits the two graduation transactions when a curve sells out. It needs no HTTP server or Fastify process. The current factory uses a mock venue: graduation produces an explorer-visible pool address, but that pool cannot execute swaps.

## Run on a VPS

Install Node.js 20 or newer, then from this directory:

```bash
npm ci --omit=dev
npm start
```

Set the `KEEPER_*` environment variables listed in `.env.example` through your process manager. `npm start` does not load an `.env` file itself. Use a dedicated private key with native ETH for transaction fees. Run **one instance** for that wallet and configure automatic restart and log monitoring. The private key must stay on the server; never use a `VITE_` variable or put it in Vercel.

`KEEPER_CHAIN_ID` must match the RPC chain, and `KEEPER_FACTORY_ADDRESS` and `KEEPER_DEPLOYMENT_BLOCK` must refer to the same factory. The worker scans from that block **on every start** so it can recover missed launches; there is no persisted cursor. Active market status reads run with bounded concurrency; wallet transactions run sequentially to preserve nonce order. The default poll interval is 10 seconds **after each sweep finishes**, so it is not a guaranteed 10-second graduation time. The interval must be at least one second. Deferred graduations retry with exponential backoff, capped at one hour. A sell can reopen a full curve before pool creation; the worker checks the sold amount again before sending the second transaction.

The worker logs submitted transaction hashes, confirmed pool addresses, venue deferrals, and failures to standard output/error. It has no HTTP health endpoint or built-in alerting. Watch the process and logs, and keep enough ETH in the keeper wallet for both transactions. On a restart, allow time for the historical event scan before expecting new graduations.

Run `npm test` to check the graduation and retry flow locally. These tests use mocked chain clients; verify a complete sellout and graduation on testnet before depending on the worker for a new venue.
