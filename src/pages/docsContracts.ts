import mainnetIcarus from "../../deployments/4153/icarus-verification.json";
import { RISE_MAINNET_EXPLORER_URL } from "../sdk/curveballSdk";

export type DocumentedContract = {
  name: string;
  address: string;
  purpose: string;
};

type OracleRecord = {
  chainId: number;
  launchpad: string;
  owner: string;
  quote: string;
  icarusFactory: string;
  storkOracle: string;
  singletons: {
    escrow: string;
    locker: string;
    buybackTreasury: string;
    tokenImplementation: string;
  };
};
type AdapterRecord = { adapter: string };
const oracleRecord = Object.values(typeof import.meta.glob === "function" ? import.meta.glob("../../deployments/4153/curveball-oracle-v3.json", {
  eager: true, import: "default",
}) : {})[0] as OracleRecord | undefined;
const oracleAdapter = Object.values(typeof import.meta.glob === "function" ? import.meta.glob("../../deployments/4153/icarus-swap-adapter-oracle-v3.json", {
  eager: true, import: "default",
}) : {})[0] as AdapterRecord | undefined;

const protocol: DocumentedContract[] = oracleRecord && oracleAdapter ? [
  { name: "Launchpad", address: oracleRecord.launchpad, purpose: "Creates markets and charges the Stork priced launch fee." },
  { name: "Fee escrow", address: oracleRecord.singletons.escrow, purpose: "Distributes eligible fees." },
  { name: "LP locker", address: oracleRecord.singletons.locker, purpose: "Holds graduated liquidity." },
  { name: "Buyback treasury", address: oracleRecord.singletons.buybackTreasury, purpose: "Receives the buyback share." },
  { name: "Token implementation", address: oracleRecord.singletons.tokenImplementation, purpose: "Implementation for new market tokens." },
  { name: "Swap adapter", address: oracleAdapter.adapter, purpose: "Routes graduated markets to Icarus pools." },
  { name: "Timelock controller", address: oracleRecord.owner, purpose: "Controls delayed administration." },
] : [];

export const documentedNetworks = [
  {
    name: "RISE Mainnet",
    chainId: 4_153,
    explorer: RISE_MAINNET_EXPLORER_URL,
    protocol,
    dependencies: [
      { name: "Stork oracle", address: oracleRecord?.storkOracle ?? "0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62", purpose: "Prices the $1 launch fee from ETH/USDC." },
      { name: "WETH", address: "0x4200000000000000000000000000000000000006", purpose: "Quote and settlement token." },
      { name: "Icarus factory", address: "0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615", purpose: "Creates graduated-market pools." },
      { name: "Icarus pool implementation", address: mainnetIcarus.verification.implementation.address, purpose: "Implementation used by Icarus pools." },
    ] satisfies DocumentedContract[],
  },
] as const;
