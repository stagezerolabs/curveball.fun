# Graduation keeper

A standalone Node.js worker for the active Curveball factory. It discovers launches, watches curves, and submits the two graduation transactions when a curve sells out. It needs no HTTP server.

## Run on a VPS

Install Node.js 20 or newer, then from this directory:

```bash
npm ci --omit=dev
npm start
```

Set the `KEEPER_*` environment variables in `.env.example` through your process manager. Use a dedicated private key with native ETH for transaction fees. Run **one instance** for that wallet and configure automatic restart and log monitoring. The private key must stay on the server; never use a `VITE_` variable or put it in Vercel.

`KEEPER_DEPLOYMENT_BLOCK` must be the factory's deployment block. The worker scans from that block at startup so it can recover missed launches. Active market status reads run with bounded concurrency; wallet transactions run sequentially to preserve nonce order. The default poll interval is 10 seconds. Deferred graduations retry with backoff, up to one hour.

Run `npm test` to check the graduation and retry flow locally. This deployment currently uses a mock venue, so graduated pools have an explorer address but cannot execute swaps.
