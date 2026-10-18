import { parseAbi } from "viem";

/** ERC-20 plus WETH's deposit and withdraw, for the quote token and launch tokens. */
export const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function deposit() payable",
  "function withdraw(uint256 amount)",
]);

// The launchpad and its singletons, generated from the forge artifacts by `make -C contracts abis`.
export * from "./abis.generated";
