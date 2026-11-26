// Event factories shared by the pure leaderboard tests. Each curve trade also emits
// its launchpad Transfer leg, as the real indexer records both.
export const E = 10n ** 18n;
export const LAUNCHPAD = "0xlaunchpad";
export const DAY = 86400;
export const T0 = 1_800_000_000;

export function eventFactory() {
  let block = 100n;
  const events = [];
  const at = (seconds) => ({ at: seconds });
  const next = (opts = {}) => {
    block = opts.block ?? block + 1n;
    return block;
  };
  const trade = (wallet, token, isBuy, tokens, quote, opts = {}) => {
    const blockNumber = next(opts);
    const timestamp = opts.at ?? T0 + Number(blockNumber - 100n);
    const tx = `0xtx${blockNumber}`;
    const leg = {
      kind: "transfer",
      token,
      from: isBuy ? LAUNCHPAD : wallet,
      to: isBuy ? wallet : LAUNCHPAD,
      amount: BigInt(tokens),
      blockNumber,
      txIndex: 0,
      logIndex: 0,
      ...at(timestamp),
      txHash: tx,
    };
    const swap = {
      kind: "trade",
      token,
      trader: wallet,
      isBuy,
      tokenAmount: BigInt(tokens),
      netQuote: BigInt(quote),
      antiSnipeTax: BigInt(opts.antiSnipeTax ?? 0n),
      vQ: opts.vQ ?? null,
      vT: opts.vT ?? null,
      blockNumber,
      txIndex: 0,
      logIndex: 1,
      ...at(timestamp),
      txHash: tx,
    };
    events.push(leg, swap);
    return swap;
  };
  const transfer = (from, to, token, amount, opts = {}) => {
    const blockNumber = next(opts);
    const timestamp = opts.at ?? T0 + Number(blockNumber - 100n);
    const event = {
      kind: "transfer",
      token,
      from,
      to,
      amount: BigInt(amount),
      blockNumber,
      txIndex: 0,
      logIndex: 0,
      ...at(timestamp),
      txHash: `0xtx${blockNumber}`,
    };
    events.push(event);
    return event;
  };
  return {
    events,
    buy: (w, t, tokens, quote, opts) => trade(w, t, true, tokens, quote, opts),
    sell: (w, t, tokens, quote, opts) => trade(w, t, false, tokens, quote, opts),
    transfer,
    forWallet: (wallet) =>
      events.filter(
        (e) =>
          (e.kind === "trade" && e.trader === wallet) ||
          (e.kind === "transfer" && (e.from === wallet || e.to === wallet)),
      ),
  };
}

export const AS_OF = T0 + 40 * DAY;
export const CREATOR = "0xcreator";

// A deep, freshly traded market: 1 WETH real quote on a 1 WETH virtual reserve.
export function market(token, overrides = {}) {
  const vQ = overrides.vQ ?? 2n * E;
  const k = 1000000000n * E * E;
  return {
    token,
    creator: CREATOR,
    launchpad: LAUNCHPAD,
    launchBlock: 1n,
    initialVirtualQuote: E,
    feeBps: 75,
    creatorTaxBps: 0,
    state: "trading",
    vQ,
    vT: overrides.vT ?? (k + vQ - 1n) / vQ,
    latestTradeAt: AS_OF - 3600,
    ...overrides,
  };
}

// Splits factory events into the engine's trade and transfer inputs.
export function engineInput(f, markets, extra = {}) {
  return {
    asOfBlock: 1_000_000n,
    asOfTime: AS_OF,
    markets,
    statesByToken: new Map(),
    trades: f.events.filter((e) => e.kind === "trade"),
    transfers: f.events.filter((e) => e.kind === "transfer"),
    protocolAccounts: [LAUNCHPAD],
    follows: [],
    ...extra,
  };
}
