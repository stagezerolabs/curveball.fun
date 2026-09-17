import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { hardhat } from "wagmi/chains";
import { createPublicClient, defineChain, http, parseAbiItem } from "viem";

const rise = defineChain({
  id: 4153,
  name: "RISE",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.risechain.com/"] } },
});

const chain = import.meta.env.VITE_CHAIN_ID === "31337" ? hardhat : rise;

export const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";
export const launchpadAddress = import.meta.env.VITE_LAUNCHPAD_ADDRESS;
export const contractAbi = [
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

export const tokenCreatedEvent = parseAbiItem(
  "event TokenCreated(address indexed token,address indexed creator,string name,string symbol,string uri)",
);

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: { [chain.id]: http(chain.rpcUrls.default.http[0]) },
});

export const publicClient = createPublicClient({
  chain,
  transport: http(chain.rpcUrls.default.http[0]),
});
