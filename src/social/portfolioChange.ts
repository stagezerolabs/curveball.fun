type HoldingChange = {
  valueWeth: number;
  change24hBps: string | null;
};

/** Mark-to-market change of current holdings, excluding wallet cash flows. */
export function calculateHoldingsChange24h(holdings: HoldingChange[]) {
  let currentValue = 0;
  let previousValue = 0;

  for (const { valueWeth, change24hBps } of holdings) {
    if (!Number.isFinite(valueWeth) || valueWeth < 0) return null;
    if (valueWeth === 0) continue;
    if (change24hBps === null) return null;

    const priceRatio = 1 + Number(change24hBps) / 10_000;
    if (!Number.isFinite(priceRatio) || priceRatio <= 0) return null;

    currentValue += valueWeth;
    previousValue += valueWeth / priceRatio;
  }

  return previousValue > 0
    ? ((currentValue - previousValue) / previousValue) * 100
    : null;
}
