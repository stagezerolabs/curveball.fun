import mainnet from "../../deployments/4153/curveball.json";
import mainnetAdapter from "../../deployments/4153/icarus-swap-adapter.json";
import mainnetIcarus from "../../deployments/4153/icarus-verification.json";
import { RISE_MAINNET_EXPLORER_URL } from "../sdk/curveballSdk";
import { activeLaunchFeeMode } from "../lib/web3";

export type DocumentedContract = {
  name: string;
  address: string;
  purpose: string;
};

const oracleRecord = Object.values(import.meta.glob("../../deployments/4153/curveball-oracle-v3.json", {
  eager: true, import: "default",
}))[0] as (typeof mainnet & { storkOracle: string }) | undefined;
const oracleAdapter = Object.values(import.meta.glob("../../deployments/4153/icarus-swap-adapter-oracle-v3.json", {
  eager: true, import: "default",
}))[0] as typeof mainnetAdapter | undefined;
const activeOracle = activeLaunchFeeMode === "oracle" && oracleRecord && oracleAdapter;
const protocol = [
  ...(activeOracle ? [
    { name: "Oracle launchpad", address: oracleRecord.launchpad, purpose: "Creates new markets and charges the Stork priced launch fee." },
    { name: "Oracle fee escrow", address: oracleRecord.singletons.escrow, purpose: "Distributes fees from new markets." },
    { name: "Oracle LP locker", address: oracleRecord.singletons.locker, purpose: "Holds new markets' graduated liquidity." },
    { name: "Oracle buyback treasury", address: oracleRecord.singletons.buybackTreasury, purpose: "Receives new markets' buyback share." },
    { name: "Oracle token implementation", address: oracleRecord.singletons.tokenImplementation, purpose: "Implementation for new market tokens." },
    { name: "Oracle swap adapter", address: oracleAdapter.adapter, purpose: "Routes new graduated markets to Icarus pools." },
    { name: "Oracle timelock", address: oracleRecord.owner, purpose: "Controls delayed administration of the new launchpad." },
  ] : []),
  { name: activeOracle ? "Legacy launchpad" : "Launchpad", address: mainnet.launchpad, purpose: "Creates markets and runs the bonding curves." },
  { name: activeOracle ? "Legacy fee escrow" : "Fee escrow", address: mainnet.singletons.escrow, purpose: "Receives and distributes eligible pool fees." },
  { name: activeOracle ? "Legacy LP locker" : "LP locker", address: mainnet.singletons.locker, purpose: "Holds the liquidity position after graduation." },
  { name: activeOracle ? "Legacy buyback treasury" : "Buyback treasury", address: mainnet.singletons.buybackTreasury, purpose: "Receives the buyback share of fees." },
  { name: activeOracle ? "Legacy token implementation" : "Token implementation", address: mainnet.singletons.tokenImplementation, purpose: "Implementation used for existing market tokens." },
  { name: activeOracle ? "Legacy swap adapter" : "Swap adapter", address: mainnetAdapter.adapter, purpose: "Routes existing graduated markets to Icarus pools." },
  { name: activeOracle ? "Legacy timelock" : "Timelock controller", address: mainnet.owner, purpose: "Controls delayed protocol administration." },
] satisfies DocumentedContract[];

export const documentedNetworks = [
  {
    name: "RISE Mainnet",
    chainId: mainnet.chainId,
    explorer: RISE_MAINNET_EXPLORER_URL,
    protocol,
    dependencies: [
      ...(activeOracle ? [{ name: "Stork oracle", address: oracleRecord.storkOracle, purpose: "Prices the new launch fee from ETH/USDC." }] : []),
      { name: "WETH", address: mainnet.quote, purpose: "Quote and settlement token." },
      { name: "Icarus factory", address: mainnet.icarusFactory, purpose: "Creates graduated-market pools." },
      { name: "Icarus pool implementation", address: mainnetIcarus.verification.implementation.address, purpose: "Implementation used by Icarus pools." },
    ] satisfies DocumentedContract[],
  },
] as const;
