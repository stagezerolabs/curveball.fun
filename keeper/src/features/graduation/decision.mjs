/** Chooses the action for a market from its current onchain status. */
export function decide({
  state,
  soldOut,
  readyAt,
  nowSeconds,
  timeout,
  graduationReverts = false,
  buyback,
}) {
  if (state === "ready") {
    if (graduationReverts && nowSeconds >= readyAt + timeout) return "abort";
    return graduationReverts ? "wait" : "graduate";
  }
  if (state === "aborted")
    return soldOut && !graduationReverts ? "graduate" : "wait";
  if (state === "graduated" && buyback?.balance > 0n) return "convert";
  return "wait";
}
