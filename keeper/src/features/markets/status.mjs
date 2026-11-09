import { launchpadAbi, buybackAbi } from "../../../abi.mjs";

/** CurveLaunchpad.State, in enum order. */
const STATES = ["none", "trading", "ready", "graduated", "aborted"];

export async function readMarketStatus({
  publicClient,
  launchpad,
  constants,
  token,
}) {
  const market = await publicClient.readContract({
    address: launchpad,
    abi: launchpadAbi,
    functionName: "market",
    args: [token],
  });
  const state = STATES[market.state] ?? "none";
  const status = {
    state,
    soldOut: market.virtualToken === constants.terminalVirtualToken,
    readyAt: BigInt(market.readyAt),
  };
  if (state !== "graduated") return status;
  const balance = await publicClient.readContract({
    address: constants.buybackTreasury,
    abi: buybackAbi,
    functionName: "tokenBudget",
    args: [token],
  });
  return {
    ...status,
    buyback: { balance },
  };
}
