import mainnet from "../../deployments/4153/curveball.json";
import mainnetAdapter from "../../deployments/4153/icarus-swap-adapter.json";
import mainnetIcarus from "../../deployments/4153/icarus-verification.json";
import { RISE_MAINNET_EXPLORER_URL } from "../sdk/curveballSdk";

export type DocumentedContract = {
  name: string;
  address: string;
  purpose: string;
};

export const documentedNetworks = [
  {
    name: "RISE Mainnet",
    chainId: mainnet.chainId,
    explorer: RISE_MAINNET_EXPLORER_URL,
    protocol: [
      { name: "Launchpad", address: mainnet.launchpad, purpose: "Creates markets and runs the bonding curves." },
      { name: "Fee escrow", address: mainnet.singletons.escrow, purpose: "Receives and distributes eligible pool fees." },
      { name: "LP locker", address: mainnet.singletons.locker, purpose: "Holds the liquidity position after graduation." },
      { name: "Buyback treasury", address: mainnet.singletons.buybackTreasury, purpose: "Receives the buyback share of fees." },
      { name: "Token implementation", address: mainnet.singletons.tokenImplementation, purpose: "Implementation used for newly created market tokens." },
      { name: "Swap adapter", address: mainnetAdapter.adapter, purpose: "Routes graduated-market trades to Icarus pools." },
      { name: "Timelock controller", address: mainnet.owner, purpose: "Controls delayed protocol administration." },
    ] satisfies DocumentedContract[],
    dependencies: [
      { name: "WETH", address: mainnet.quote, purpose: "Quote and settlement token." },
      { name: "Icarus factory", address: mainnet.icarusFactory, purpose: "Creates graduated-market pools." },
      { name: "Icarus pool implementation", address: mainnetIcarus.verification.implementation.address, purpose: "Implementation used by Icarus pools." },
    ] satisfies DocumentedContract[],
  },
] as const;
