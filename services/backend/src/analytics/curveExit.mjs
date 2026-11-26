// Pure BigInt port of CurveMath.quoteSell (contracts/contracts/libraries/CurveMath.sol).
// Must not import config: the leaderboard engine and its tests are pure.
const BPS = 10000n;

export function ceilDiv(a, b) {
  return a === 0n ? 0n : (a - 1n) / b + 1n;
}

function big(value) {
  if (value === null || value === undefined) return null;
  return BigInt(value);
}

// Line-for-line port of quoteSell. Reverts become `error` strings; never throws.
export function quoteSellExact({ vT, vQ, realQuote, amount, feeBps, taxBps }) {
  const t = big(vT);
  const q = big(vQ);
  const real = big(realQuote) ?? 0n;
  const x = big(amount) ?? 0n;
  const fBps = big(feeBps) ?? 0n;
  const tBps = big(taxBps) ?? 0n;
  const empty = { gross: 0n, fee: 0n, tax: 0n, net: 0n };
  if (x <= 0n) return { ...empty, error: "InvalidAmount" };
  if (t === null || q === null || t <= 0n || q <= 0n) {
    return { ...empty, error: "ZeroOutput" };
  }
  const gross = q - ceilDiv(t * q, t + x);
  const fee = (gross * fBps) / BPS;
  const tax = (gross * tBps) / BPS;
  const net = gross - fee - tax;
  let error = null;
  if (gross === 0n) error = "ZeroOutput";
  else if (gross > real) error = "InsufficientReserve";
  else if (fBps !== 0n && fee === 0n) error = "DustTrade";
  return { gross, fee, tax, net, error };
}

// The ranking mark: what selling `amount` would actually return. Gross above real
// reserves is clamped to real reserves (the contract would revert), and an unsellable
// dust amount is worth zero.
export function exitValue({ vT, vQ, realQuote, amount, feeBps, taxBps }) {
  const quote = quoteSellExact({ vT, vQ, realQuote, amount, feeBps, taxBps });
  if (quote.error === "InvalidAmount" || quote.error === "ZeroOutput") return 0n;
  const real = big(realQuote) ?? 0n;
  if (real <= 0n) return 0n;
  const fBps = big(feeBps) ?? 0n;
  const tBps = big(taxBps) ?? 0n;
  const gross = quote.gross > real ? real : quote.gross;
  const fee = (gross * fBps) / BPS;
  const tax = (gross * tBps) / BPS;
  if (fBps !== 0n && fee === 0n) return 0n;
  const net = gross - fee - tax;
  return net > 0n ? net : 0n;
}
