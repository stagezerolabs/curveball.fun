import { expect, test } from "bun:test";
import { connect, createConfig } from "@wagmi/core";
import { mock } from "wagmi/connectors";
import { createPublicClient, createWalletClient, defineChain, http, parseEther, type Address, type Hex } from "viem";
import { defineCurveballDeployment } from "./curveballSdk";
import { createV2Sdk } from "./v2Sdk";
import { v2CurveAbi, v2FactoryAbi, v2LockerAbi } from "./v2Contracts";

const artifact = async (name: string) => {
  const source = name === "MockIcarusFactory" ? "MockIcarus" : name;
  const sourceName = name === "CurveLpLocker" ? "LpLocker" : source;
  const file = Bun.file(new URL(`../../contracts/out/${sourceName}.sol/${name}.json`, import.meta.url));
  const json = await file.json();
  return { abi: json.abi, bytecode: json.bytecode.object as Hex };
};

test.skipIf(Bun.env.RUN_LOCAL_CHAIN_INTEGRATION !== "1")("wallet SDK launches, trades, sweeps, and graduates against deployed V2 contracts", async () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  const rpcUrl = `http://127.0.0.1:${port}`;
  const proc = Bun.spawn(["anvil", "--port", String(port), "--chain-id", "31337", "--silent"], { stdout: "ignore", stderr: "pipe" });
  const chain = defineChain({ id: 31337, name: "V2 SDK Anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: 100 });
  try {
    let started = false;
    for (let i = 0; i < 50; i++) {
      try { started = (await publicClient.getChainId()) === 31337; if (started) break; }
      catch { await Bun.sleep(100); }
    }
    if (!started) throw Error("Anvil did not start");
    const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_accounts", params: [] }) });
    const account = ((await response.json()).result as Address[])[0];
    const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
    const deploy = async (name: string, args: readonly unknown[] = []) => {
      const { abi, bytecode } = await artifact(name);
      let hash;
      try { hash = await wallet.deployContract({ abi, bytecode, args: [...args] }); }
      catch (error) { throw Error(`${name} deployment failed: ${(error as Error).message.slice(-400)}`); }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress) throw Error(`${name} did not deploy`);
      return receipt.contractAddress;
    };
    const quote = await deploy("MockWETH");
    const icarus = await deploy("MockIcarusFactory");
    const factory = await deploy("CurveLaunchFactory", [quote, icarus, account, parseEther("1000000"), parseEther("800000"), parseEther("10")]);
    const deployer = await deploy("CurveLaunchDeployer", [factory]);
    const escrow = await deploy("CurveFeeEscrow", [factory]);
    const vault = await deploy("CurveBuybackVault", [factory, quote]);
    const guard = await deploy("CurveGraduationGuard", [icarus]);
    const locker = await deploy("CurveLpLocker", [factory]);
    const executor = await deploy("CurveGraduationExecutor", [factory, icarus, quote, locker]);
    const hook = await deploy("CurveMemeHook", [factory, locker, quote, escrow, vault]);
    const launchAndBuy = await deploy("CurveLaunchAndBuy", [factory, quote]);
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: factory, abi: v2FactoryAbi, functionName: "initialize", args: [{ deployer, escrow, vault, guard, executor, locker, hook, launchAndBuy }] }) });
    expect(await publicClient.readContract({ address: factory, abi: v2FactoryAbi, functionName: "publicLaunchOpen" })).toBe(true);
    const config = createConfig({ chains: [chain], connectors: [mock({ accounts: [account] })], transports: { [chain.id]: http(rpcUrl) }, pollingInterval: 100 });
    await connect(config, { connector: config.connectors[0] });
    const sdk = createV2Sdk(config, defineCurveballDeployment({ chainId: 31337, launchpad: factory, deadlineSeconds: 3_600 }));

    const launched = await sdk.createToken({ name: "SDK V2", symbol: "SDKV2", uri: "", creatorTaxBps: 25 });
    expect(launched.curve).not.toBe(factory);
    let buy;
    try { buy = await sdk.trade("buy", launched.token, parseEther("1")); }
    catch (error) {
      const quoteContract = (await artifact("MockWETH")).abi;
      const allowance = await publicClient.readContract({ address: quote, abi: quoteContract, functionName: "allowance", args: [account, launched.curve] });
      const balance = await publicClient.readContract({ address: quote, abi: quoteContract, functionName: "balanceOf", args: [account] });
      throw Error(`First buy failed with allowance ${allowance}, balance ${balance}: ${(error as Error).message.slice(0, 600)}`);
    }
    expect(buy.receipt.status).toBe("success");
    expect(buy.wrappedAmount).toBe(parseEther("1"));
    const quoteBalance = await publicClient.readContract({ address: vault, abi: [{ type: "function", name: "quoteBalance", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const, functionName: "quoteBalance", args: [launched.token] });
    expect(quoteBalance).toBeGreaterThan(0n);
    await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "evm_increaseTime", params: [1801] }) });
    await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "evm_mine", params: [] }) });
    const sweep = await sdk.sweepBuyback(launched.token, quoteBalance / 4n, 1n);
    expect(sweep.receipt.status).toBe("success");
    let full;
    try { full = await sdk.trade("buy", launched.token, parseEther("50")); }
    catch (error) {
      const quoteContract = (await artifact("MockWETH")).abi;
      const allowance = await publicClient.readContract({ address: quote, abi: quoteContract, functionName: "allowance", args: [account, launched.curve] });
      throw Error(`Full buy failed with allowance ${allowance}: ${(error as Error).message.slice(0, 600)}`);
    }
    expect(full.receipt.status).toBe("success");
    expect(await publicClient.readContract({ address: launched.curve, abi: v2CurveAbi, functionName: "sold" })).toBe(parseEther("800000"));
    await sdk.graduate(launched.token);
    const graduated = await sdk.createGraduatedPool(launched.token);
    expect(graduated.receipt.status).toBe("success");
    const pool = await publicClient.readContract({ address: launched.curve, abi: v2CurveAbi, functionName: "pool" });
    expect(await publicClient.readContract({ address: locker, abi: v2LockerAbi, functionName: "tokenOfPool", args: [pool] })).toBe(launched.token);
    expect((await sdk.claimPoolFees(locker, pool)).receipt.status).toBe("success");
  } finally {
    proc.kill();
    await proc.exited;
  }
}, 120_000);
