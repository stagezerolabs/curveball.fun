import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { hardhat } from "wagmi/chains";
import { defineChain, http } from "viem";

const rise = defineChain({
  id: 4153,
  name: "RISE",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.risechain.com/"] } },
});

const chain = import.meta.env.VITE_CHAIN_ID === "31337" ? hardhat : rise;

export const apiUrl = "/api";
export const launchpadAddress = import.meta.env.VITE_LAUNCHPAD_ADDRESS;
export const contractAbi = [
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "createToken",
    stateMutability: "nonpayable",
    inputs: [
      { type: "string", name: "n" },
      { type: "string", name: "s" },
      { type: "string", name: "u" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "buyTokens",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "t" },
      { type: "uint256", name: "q" },
      { type: "uint256", name: "m" },
      { type: "uint256", name: "deadline" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sellTokens",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "t" },
      { type: "uint256", name: "a" },
      { type: "uint256", name: "m" },
      { type: "uint256", name: "deadline" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "t" },
      { type: "uint256", name: "q" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteSell",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "t" },
      { type: "uint256", name: "a" },
    ],
    outputs: [{ type: "uint256" }],
  },
];

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "owner" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "owner" },
      { type: "address", name: "spender" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "spender" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [{ type: "bool" }],
  },
];

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: { [chain.id]: http(chain.rpcUrls.default.http[0]) },
});

export const lockerAbi = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "pool" }],
    outputs: [],
  },
];
