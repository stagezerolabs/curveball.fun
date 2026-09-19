import { expect, test } from "bun:test";
import { connect, createConfig, getBytecode, writeContract } from "@wagmi/core";
import { mock } from "wagmi/connectors";
import {
  defineChain,
  getAddress,
  http,
  parseAbi,
  parseEther,
  type Address,
} from "viem";
import { defineCurveballDeployment } from "./curveballSdk";
import { createWagmiCurveballSdk } from "./wagmiSdk";

const rpcUrl = Bun.env.SDK_FORK_RPC_URL;
const launchpad = Bun.env.SDK_FORK_LAUNCHPAD as Address | undefined;
const account = Bun.env.SDK_FORK_ACCOUNT as Address | undefined;

test.skipIf(!rpcUrl || !launchpad || !account)(
  "the SDK validates, creates, approves, and buys against a RISE fork",
  async () => {
    const riseFork = defineChain({
      id: 4153,
      name: "RISE fork",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl!] } },
    });
    const config = createConfig({
      chains: [riseFork],
      connectors: [mock({ accounts: [getAddress(account!)] })],
      transports: { [riseFork.id]: http(rpcUrl) },
    });
    await connect(config, { connector: config.connectors[0] });
    const sdk = createWagmiCurveballSdk(
      config,
      defineCurveballDeployment({ chainId: 4153, launchpad: launchpad! }),
    );

    const runtime = await sdk.validateDeployment({
      factory: "0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615",
      quote: "0x4200000000000000000000000000000000000006",
      supply: 1_000_000n * 10n ** 18n,
      curveSupply: 800_000n * 10n ** 18n,
      initialVirtualQuote: 10n * 10n ** 18n,
      creatorShareBps: 5_000,
      quoteSymbol: "WETH",
      quoteDecimals: 18,
    });
    expect(runtime.treasury).toBe(getAddress(account!));

    const created = await sdk.createToken({
      name: "SDK Integration",
      symbol: "SDKI",
      uri: "https://curveball.fun/api/metadata/nominatebear",
    });
    expect(await getBytecode(config, { address: created.token, chainId: 4153 })).not.toBe("0x");

    await writeContract(config, {
      account: getAddress(account!),
      address: runtime.quote,
      abi: parseAbi(["function deposit() payable"]),
      functionName: "deposit",
      value: parseEther("2"),
      chainId: 4153,
    });
    const trade = await sdk.trade("buy", created.token, parseEther("1"));
    expect(trade.receipt.status).toBe("success");
    expect(trade.minimumOutput).toBeGreaterThan(0n);

    const replacementTreasury = getAddress("0x1111111111111111111111111111111111111111");
    const handoff = await sdk.handoffTreasury(replacementTreasury);
    expect(handoff.receipt.status).toBe("success");
    expect((await sdk.validateDeployment()).treasury).toBe(replacementTreasury);
  },
  30_000,
);
