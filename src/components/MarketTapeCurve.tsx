import { useCurveTapeStats } from "../lib/useCurveTapeStats";
import { MarketTape } from "./MarketTape";

export function MarketTapeCurve() {
  return <MarketTape curveStats={useCurveTapeStats()} />;
}
