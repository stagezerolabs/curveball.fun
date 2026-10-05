# Curveball — Progress update for business

> From engineering · 30 September 2026
> Short version: the product works and is live on a test network. We rebuilt the core contracts with a real fee model (V2), it's verified, and we're mid-switchover. Mainnet launch (real money) is the big milestone, still gated on an external audit and governance ops.

---

## 1. What we're building, in one paragraph

Curveball is a web app on the RISE blockchain where anyone can create their own token, trade it in a fair, automatic market (a "bonding curve" — price rises as people buy), and when the token sells out, it automatically moves into a permanent, liquid pool (on Icarus) where trading continues. Liquidity is permanently locked so creators can never withdraw it after launch.

## 2. Current state

Everything below is deployed and public on **RISE Testnet** (the practice network — ETH there is fake, not real money).

| Piece | What it is | Status |
| --- | --- | --- |
| Smart contracts | Create tokens, curve trading, graduation, locked LP | Live and verified on testnet |
| Web app | Markets list, launch token, trade panel, wallet, profiles | Live, public |
| API + database | Serves markets, prices, USD values, trade history | Live |
| Indexer | Reads all on-chain events into the database | Live |
| Test suite | 58+ contract tests, fuzzing (~20,000 calls), full lifecycle tests on testnet | Passing |

Anyone can open the site (curveball-fun.netlify.app), connect a wallet, create a token, and trade it today — using test money.

## 3. What I'm working on now

1. **V2 platform upgrade (main focus, near done).** We rebuilt the entire contract layer with a real fee model:
   - New revenue model: 0.5% fee on curve trades, split 50% creator / 25% protocol treasury / 25% protocol buyback; creators may add an optional extra fee (capped 0.5%). Fees flow the same way after graduation.
   - Buyback program: protocol's share buys token back over time; held for 5 years.
   - Safer graduation: if pool creation fails, funds are never stranded; anyone can retry.
   - Split into 11 separate contracts (down from one big one) to keep each auditable and under size limits.
   - **Done:** fully built, tested, deployed on testnet, verified block-by-block on the explorer, database migrated (with a tested rollback). The new fee model is live in the contracts.
   - **Remaining:** switch the app over to the new contracts ("cutover"), run live smoke tests, commit.
2. **USD prices.** Prices and market caps now display in USD (live ETH/USD rate). Mostly done in the UI; remaining: auto-refresh every ~15s and a couple of display surfaces.
3. **Housekeeping.** Committing the uncommitted V2 work and cleaning up a small experiment worker.

## 4. Roadmap

| When | What | Why |
| --- | --- | --- |
| Next | Finish V2 cutover + smoke tests, commit | Current focus; contracts are already on the new model |
| After that | Finish USD polish; small features (human-readable wallet names) | User-facing completeness |
| Then | Prepare mainnet launch (real money): launch our own token (working name CURVE) in **invited beta** on mainnet | Real users, real volume, real fees |
| Before mainnet can happen | External security audit (required), multisig treasury, ops hardening (isolated DB, always-on indexer, monitoring), verified deployment | Gates we've set; we will not launch with real money without them |
| Later (separate decision) | Open token creation to the public after beta; then platform growth features | Irreversible step; business needs to weigh in with audit + beta data |

## 5. How this makes money (the business answer)

- **Fee revenue:** protocol's treasury earns a share of every trade on the platform (25% of a 0.5% fee on each trade, plus more after graduation). Revenue scales with real volume.
- **When:** only on mainnet. Testnet is free practice — no real revenue yet.
- **What has to be true for revenue:** mainnet launch passes its gates (audit, multisig), and enough creators/traders use it that the curve and pool fees actually flow.

## 6. Honest status / risks

- Live product is on the **test** network — real money and revenue come only after mainnet.
- **No independent third-party audit yet.** Our own reviews are done; an external audit is a hard gate before mainnet.
- The public app is still on the old (V1) contracts; the new fee model (V2) is deployed underneath and the app switchover is what I'm doing now.
- Mainnet economics are unproven — the invited beta is designed to test real demand before we open access.
- Outstanding process item: the V2 work is built and verified but not yet committed; part of "next."

## 7. Where to look

- Live product (testnet): https://curveball-fun.netlify.app
- Technical summary: `README.md` · V2 spec: `docs/superpowers/specs/2026-09-29-curveball-v2-decomposition-design.md` · Security review: `docs/security/curveball-v2-review.md`