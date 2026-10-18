export const CURVE_MILESTONES = Object.freeze([25, 50, 70, 100]);

export function crossedCurveMilestones({ isBuy, soldAfter, tokenAmount, curveSupply }) {
  if (!isBuy) return [];
  const sold = BigInt(soldAfter);
  const amount = BigInt(tokenAmount);
  const supply = BigInt(curveSupply);
  if (supply <= 0n) return [];
  const soldBefore = sold > amount ? sold - amount : 0n;
  return CURVE_MILESTONES.filter((milestone) => (
    soldBefore * 100n < BigInt(milestone) * supply
    && sold * 100n >= BigInt(milestone) * supply
  ));
}
