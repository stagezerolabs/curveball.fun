// Opt-in Postgres invariant test. Runs only with CURVEBALL_TEST_DATABASE_URL pointing at a
// migrated scratch database (never the `curveball` database):
//   docker exec curveball-mainnet-postgres-1 createdb -U curveball curveball_test
//   SOCIAL_DIRECT_DATABASE_URL=<scratch url> bun services/backend/src/entrypoints/migrate.mjs
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const url = process.env.CURVEBALL_TEST_DATABASE_URL;
const isScratch = Boolean(url) && !/\/curveball(\?|$)/.test(url);

process.env.SOCIAL_DATABASE_URL ||=
  "postgres://unused:unused@localhost:5432/unused";
process.env.SOCIAL_LAUNCHPAD_ADDRESS ||=
  "0x5cc42e772f67089b4670eec4dcd904be2f2d511c";
process.env.SOCIAL_ADMIN_ADDRESS ||=
  "0x5cc42e772f67089b4670eec4dcd904be2f2d511c";
process.env.SOCIAL_DEPLOYMENT_BLOCK ||= "1";
process.env.PRIVY_APP_ID ||= "test-privy-app";
process.env.PRIVY_APP_SECRET ||= "test-privy-secret";

const CHAIN = 990001;

describe.skipIf(!isScratch)("v3 leaderboard against Postgres", () => {
  let pool;
  let publish;
  let load;
  let evaluate;
  let fixtures;

  const clean = async () => {
    await pool.query(
      `DELETE FROM leaderboard_snapshots WHERE chain_id=$1;
      DELETE FROM trades WHERE chain_id=$1;
      DELETE FROM asset_transfers WHERE chain_id=$1;
      DELETE FROM markets WHERE chain_id=$1;
      DELETE FROM protocol_accounts WHERE chain_id=$1;`.replaceAll("$1", String(CHAIN)),
    );
  };

  beforeAll(async () => {
    const { createDatabase } = await import("@curveball/db");
    pool = createDatabase({ connectionString: url, max: 2 }).pool;
    ({ publishLeaderboards: publish, loadLeaderboardInputs: load } = await import(
      "../../src/analytics/performance.mjs"
    ));
    ({ evaluateLeaderboards: evaluate } = await import(
      "../../src/analytics/leaderboardEngine.mjs"
    ));
    fixtures = await import("./ledgerFixtures.mjs");
    const { AS_OF, DAY, E, LAUNCHPAD, eventFactory } = fixtures;
    await clean();

    const milli = (n) => (BigInt(n) * E) / 1000n;
    const f = eventFactory();
    for (const token of ["0xa", "0xb", "0xc"]) {
      for (let i = 0; i < 5; i++)
        f.buy(`0xcrowd${i}`, token, 1000n, milli(1) / 10n, { at: AS_OF - 30 * DAY + i });
    }
    ["0xa", "0xb", "0xc", "0xa", "0xb", "0xc"].forEach((token, i) => {
      const at = AS_OF - 20 * DAY + i * DAY;
      f.buy("0xgood", token, 1000n, milli(50), { at });
      f.sell("0xgood", token, 1000n, milli(60), { at: at + 60 });
    });
    f.buy("0xgood", "0xa", 100000000n * E, milli(100), { at: AS_OF - DAY });
    f.transfer("0xgood", "0xelsewhere", "0xa", 10000000n * E, { at: AS_OF - DAY + 5 });
    f.buy("0xmixed", "0xb", 100000000n * E, milli(80), { at: AS_OF - DAY + 10 });
    f.sell("0xmixed", "0xb", 50000000n * E, milli(20), { at: AS_OF - DAY + 15 });

    const vQ = 2n * E;
    const vT = (10n ** 27n * E + vQ - 1n) / vQ;
    for (const token of ["0xa", "0xb", "0xc"]) {
      await pool.query(
        `INSERT INTO markets (chain_id,token_address,launchpad_address,creator_address,name,symbol,slug,
          launch_tx_hash,launch_log_index,launch_block,launched_at,total_supply,initial_virtual_quote,
          fee_bps,creator_tax_bps,state)
        VALUES ($1,$2,$3,'0xcreator',$2,$2,$4,'0xlaunch',0,1,to_timestamp($5),$6,$7,75,0,'trading')`,
        [CHAIN, token, LAUNCHPAD, `${CHAIN}-${token}`, AS_OF - 40 * DAY, (10n ** 27n).toString(), E.toString()],
      );
    }
    await pool.query(
      "INSERT INTO protocol_accounts (chain_id,address,role,label) VALUES ($1,$2,'launchpad','launchpad')",
      [CHAIN, LAUNCHPAD],
    );
    let n = 0;
    for (const e of f.events) {
      n += 1;
      const common = [`${CHAIN}-${n}`, CHAIN, `0xblock${e.blockNumber}`, e.blockNumber.toString(), e.txHash, e.txIndex, e.logIndex, e.token];
      if (e.kind === "trade") {
        await pool.query(
          `INSERT INTO trades (logical_id,chain_id,block_hash,block_number,transaction_hash,transaction_index,log_index,
            token_address,launchpad_address,trader_address,is_buy,gross_curve_quote,net_trader_quote,fee_quote,
            creator_tax_quote,token_amount,virtual_quote_after,virtual_token_after,sold_after,block_timestamp)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,0,0,$13,$14,$15,0,to_timestamp($16))`,
          [...common, LAUNCHPAD, e.trader, e.isBuy, e.netQuote.toString(), e.tokenAmount.toString(), vQ.toString(), vT.toString(), e.at],
        );
      } else {
        await pool.query(
          `INSERT INTO asset_transfers (logical_id,chain_id,block_hash,block_number,transaction_hash,transaction_index,
            log_index,token_address,from_address,to_address,amount,block_timestamp)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,to_timestamp($12))`,
          [`${common[0]}-t`, ...common.slice(1), e.from, e.to, e.amount.toString(), e.at],
        );
      }
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await clean();
    await pool.end();
  });

  const publishedRows = async () =>
    (
      await pool.query(
        `SELECT s.category,s.status,s.details,r.address,r.rank,r.score::text AS score,r.metrics
        FROM leaderboard_snapshots s LEFT JOIN leaderboard_rows r ON r.snapshot_id=s.id
        WHERE s.chain_id=$1 ORDER BY s.category,r.rank`,
        [CHAIN],
      )
    ).rows;

  test("per-market P&L sums to wallet P&L and reruns are identical", async () => {
    const asOfTime = new Date(fixtures.AS_OF * 1000);
    const inputs = await load(pool, 1_000_000n, asOfTime, { chainId: CHAIN });
    const { evaluations } = evaluate(inputs);
    expect(evaluations.length).toBeGreaterThan(5);
    for (const evaluation of evaluations) {
      const net = evaluation.perMarket.reduce(
        (sum, row) => sum + BigInt(row.realizedPnlWei) + BigInt(row.unrealizedPnlWei),
        0n,
      );
      expect(net).toBe(BigInt(evaluation.metrics.netPnlWei));
    }
    const good = evaluations.find((e) => e.address === "0xgood");
    expect(good.metrics.transferOutCount).toBe(1);
    expect(BigInt(good.metrics.openValueWei) > 0n).toBe(true);

    await publish(pool, 1_000_000n, asOfTime, { chainId: CHAIN });
    const first = await publishedRows();
    await publish(pool, 1_000_000n, asOfTime, { chainId: CHAIN });
    const second = await publishedRows();
    expect(second).toEqual(first);
    const consistent = first.filter((row) => row.category === "consistent");
    expect(consistent[0].address).toBe("0xgood");
    expect(consistent[0].metrics.netPnlWei).toBe(good.metrics.netPnlWei);
  });
});
