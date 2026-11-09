import { launchpadAbi, escrowAbi, buybackAbi } from "../../../abi.mjs";

export async function readKeeperConstants({ publicClient, launchpad }) {
  const [escrow, timeout, supply, curveSupply] = await Promise.all([
    publicClient.readContract({
      address: launchpad,
      abi: launchpadAbi,
      functionName: "escrow",
    }),
    publicClient.readContract({
      address: launchpad,
      abi: launchpadAbi,
      functionName: "GRADUATION_TIMEOUT",
    }),
    publicClient.readContract({
      address: launchpad,
      abi: launchpadAbi,
      functionName: "SUPPLY",
    }),
    publicClient.readContract({
      address: launchpad,
      abi: launchpadAbi,
      functionName: "CURVE_SUPPLY",
    }),
  ]);
  const buybackTreasury = await publicClient.readContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "buybackTreasury",
  });
  const [staleness, buybackOwner] = await Promise.all([
    publicClient.readContract({
      address: buybackTreasury,
      abi: buybackAbi,
      functionName: "STALENESS",
    }),
    publicClient.readContract({
      address: buybackTreasury,
      abi: buybackAbi,
      functionName: "owner",
    }),
  ]);
  return {
    buybackTreasury,
    timeout,
    terminalVirtualToken: supply - curveSupply,
    staleness,
    buybackOwner,
  };
}
