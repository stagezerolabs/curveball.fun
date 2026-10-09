import { getAccount, readContract, simulateContract, switchChain, waitForTransactionReceipt, writeContract, type Config } from "@wagmi/core";
import { formatEther, getAddress, isAddress, parseAbi, zeroAddress, type Address, type Hash } from "viem";
import { betaDeployment } from "../lib/betaConfig";
import bridgeDeployment from "../../deployments/11155931/asd-bridge.json";
import { activeChainId, activeContractVersion, launchpadAddress, wagmiConfig } from "../lib/web3";
import { RISE_TESTNET_CHAIN_ID } from "./curveballSdk";
import { erc20Abi } from "./contracts";
import { v2CurveAbi, v2FactoryAbi } from "./v2Contracts";

const ASD = getAddress("0xaa536Bb436df3D0DfF5b0E9E513560D3491Ec182");
const bridgeValue = import.meta.env.VITE_ASD_BRIDGE_ADDRESS || bridgeDeployment.bridge;
const bridge = typeof bridgeValue === "string" && isAddress(bridgeValue) ? getAddress(bridgeValue) : null;
const betaCurve = getAddress("0x99B88a4d612fDa7914726d56d8F79b6b9E23E295");
const bridgeAbi = parseAbi([
  "function redeem(uint256 amount,uint256 deadline) returns (uint256)",
  "function mockQuote() view returns (address)",
  "function weth() view returns (address)",
]);
const config = wagmiConfig as Config;
const WETH = getAddress("0x4200000000000000000000000000000000000006");

export const asdPayment = activeChainId === RISE_TESTNET_CHAIN_ID && activeContractVersion === "v2" && betaDeployment && launchpadAddress && bridge
  ? { token: ASD, curve: betaCurve, mockQuote: betaDeployment.mweth, bridge, factory: launchpadAddress } as const
  : null;

function requirePayment() {
  if (!asdPayment) throw new Error("ASD payment is unavailable on this network.");
  return asdPayment;
}

async function verifyPayment() {
  const payment = requirePayment();
  const [mockQuote, weth, betaMarket, factoryQuote] = await Promise.all([
    readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: payment.bridge, abi: bridgeAbi, functionName: "mockQuote" }),
    readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: payment.bridge, abi: bridgeAbi, functionName: "weth" }),
    readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: betaDeployment!.factory, abi: v2FactoryAbi, functionName: "market", args: [ASD] }),
    readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: payment.factory, abi: v2FactoryAbi, functionName: "quote" }),
  ]);
  if (getAddress(mockQuote) !== payment.mockQuote || getAddress(weth) !== WETH || getAddress(factoryQuote) !== WETH || getAddress(betaMarket[0]) !== payment.curve) {
    throw new Error("ASD conversion contracts do not match the recorded markets.");
  }
  return payment;
}

async function wallet(): Promise<Address> {
  const account = getAccount(wagmiConfig);
  if (!account.address) throw new Error("Connect your wallet to continue.");
  if (account.chainId !== RISE_TESTNET_CHAIN_ID) await switchChain(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID });
  return getAddress(account.address);
}

async function confirm(hash: Hash) {
  const receipt = await waitForTransactionReceipt(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted.`);
}

async function approveIfNeeded(asset: Address, spender: Address, owner: Address, amount: bigint, step: (message: string) => void) {
  const allowance = await readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: asset, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
  if (allowance >= amount) return;
  step(`Approve ${asset === ASD ? "ASD" : "mWETH"} in your wallet`);
  const { request } = await simulateContract(config, { chainId: RISE_TESTNET_CHAIN_ID, account: owner, address: asset, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
  await confirm(await writeContract(config, request));
}

export async function quoteAsdBuy(target: Address, amount: bigint) {
  const payment = await verifyPayment();
  if (amount <= 0n) throw new Error("Enter an ASD amount greater than zero.");
  const market = await readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: payment.factory, abi: v2FactoryAbi, functionName: "market", args: [target] });
  if (market[0] === zeroAddress) throw new Error("Target market not found.");
  const [sell, reserve] = await Promise.all([
    readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: payment.curve, abi: v2CurveAbi, functionName: "quoteSell", args: [amount] }),
    readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [payment.bridge] }),
  ]);
  if (sell[0] <= 0n) throw new Error("ASD sale output is too small.");
  if (sell[0] > reserve) throw new Error(`ASD conversion is limited by the testnet WETH reserve (${formatEther(reserve)} WETH).`);
  const quote = await readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: market[0], abi: v2CurveAbi, functionName: "quoteBuy", args: [sell[0]] });
  return { quoteOut: sell[0], tokensOut: quote[0], reserve };
}

export async function convertAsdToWeth(amount: bigint, onStep: (message: string) => void): Promise<bigint> {
  const payment = await verifyPayment();
  const owner = await wallet();
  const [balance, preview] = await Promise.all([
    readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: ASD, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: payment.curve, abi: v2CurveAbi, functionName: "quoteSell", args: [amount] }),
  ]);
  if (balance < amount) throw new Error("Not enough ASD to pay for this buy.");
  const wethReserve = await readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [payment.bridge] });
  if (preview[0] > wethReserve) throw new Error("ASD conversion reserve is too low for this amount.");
  await approveIfNeeded(ASD, payment.curve, owner, amount, onStep);
  const beforeMock = await readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: payment.mockQuote, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  onStep("Sell ASD on its curve for mWETH");
  const { request: sale } = await simulateContract(config, { chainId: RISE_TESTNET_CHAIN_ID, account: owner, address: payment.curve, abi: v2CurveAbi, functionName: "sellTokens", args: [amount, preview[0] * 97n / 100n, BigInt(Math.floor(Date.now() / 1000) + 300)] });
  await confirm(await writeContract(config, sale));
  const afterMock = await readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: payment.mockQuote, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  const receivedMock = afterMock - beforeMock;
  if (receivedMock <= 0n) throw new Error("ASD was sold, but the mWETH balance has not updated. Check your wallet before retrying.");
  return convertMockToWeth(receivedMock, onStep);
}

export async function convertMockToWeth(amount: bigint, onStep: (message: string) => void): Promise<bigint> {
  const payment = await verifyPayment();
  const owner = await wallet();
  await approveIfNeeded(payment.mockQuote, payment.bridge, owner, amount, onStep);
  const beforeWeth = await readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  onStep("Convert mWETH to WETH");
  const { request: redemption } = await simulateContract(config, { chainId: RISE_TESTNET_CHAIN_ID, account: owner, address: payment.bridge, abi: bridgeAbi, functionName: "redeem", args: [amount, BigInt(Math.floor(Date.now() / 1000) + 300)] });
  await confirm(await writeContract(config, redemption));
  const afterWeth = await readContract(wagmiConfig, { chainId: RISE_TESTNET_CHAIN_ID, address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  const receivedWeth = afterWeth - beforeWeth;
  if (receivedWeth <= 0n) throw new Error("Conversion confirmed, but the WETH balance has not updated. Check your wallet before retrying.");
  return receivedWeth;
}
