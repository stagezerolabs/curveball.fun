import "@nomicfoundation/hardhat-toolbox";
import type { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: process.env.RISE_RPC_URL ? { hardhat: { forking: { url: process.env.RISE_RPC_URL } } } : {},
};
export default config;
