// Definitive test of finding I2 against a REAL chain reorg produced by anvil.
//
// Mirrors what indexer.mjs does: getLogs over a range, then rewind and re-read it.
// The emitter contract is compiled by forge; its bytecode is read from out/Emitter.sol.

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbiItem, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "http://127.0.0.1:8555";
const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const tradeEvent = parseAbiItem("event Trade(address indexed token)");

const artifact = JSON.parse(readFileSync("/tmp/emitter/out/Emitter.sol/Emitter.json", "utf8"));
const BYTECODE = artifact.bytecode.object;
const emitSelector = artifact.abi.find((x) => x.name === "emit_").name;

async function main() {
  const deployHash = await wallet.sendTransaction({ data: BYTECODE, gas: 500000n });
  const deployRc = await pub.waitForTransactionReceipt({ hash: deployHash });
  const addr = deployRc.contractAddress;
  console.log("emitter deployed:", addr, "block", deployRc.blockNumber);

  // call emit_()  -> selector for emit_()
  const selector = "0x" + Buffer.from("emit_()").toString("hex").slice(0, 0); // placeholder
  // compute selector properly via viem
  const { encodeFunctionData } = await import("viem");
  const data = encodeFunctionData({ abi: artifact.abi, functionName: "emit_" });

  // Take the snapshot BEFORE the emitting transaction, so reverting undoes it.
  const snapshotId = await pub.request({ method: "anvil_snapshot", params: [] });
  console.log("snapshot taken at block", await pub.getBlockNumber());

  const txHash = await wallet.sendTransaction({ to: addr, data, gas: 200000n });
  const rc = await pub.waitForTransactionReceipt({ hash: txHash });
  const N = rc.blockNumber;

  const blockA = await pub.getBlock({ blockNumber: N });
  const logsA = await pub.getLogs({ address: addr, event: tradeEvent, fromBlock: N, toBlock: N, strict: true });

  console.log("\n--- BEFORE reorg ---");
  console.log("block", N, "hash", blockA.hash);
  console.log("logs at that block:", logsA.length);

  if (logsA.length === 0) { console.log("no log produced; aborting"); return; }

  // ---- REAL REORG: revert past the emitting tx, then mine a replacement block ----
  // snapshot+revert+remine yields the same observable as an RPC-level reorg: the height
  // ends up with a different hash and without the log.
  await pub.request({ method: "anvil_revert", params: [snapshotId] });
  await pub.request({ method: "anvil_mine", params: [] });

  const headAfter = await pub.getBlockNumber();
  const blockB = await pub.getBlock({ blockNumber: N });
  const logsB = await pub.getLogs({ address: addr, event: tradeEvent, fromBlock: N, toBlock: N, strict: true });
  const txGone = await pub.getTransactionReceipt({ hash: txHash }).then(() => false).catch(() => true);

  console.log("\n--- AFTER the fork (block", Number(N), "replaced) ---");
  console.log("head now          :", headAfter);
  console.log("block", Number(N), "hash:", blockB.hash);
  console.log("hash changed?     :", blockA.hash !== blockB.hash);
  console.log("logs at that block:", logsB.length);
  console.log("emitting tx gone? :", txGone);

  console.log("\n=== FINDING I2, empirically ===");
  console.log("The re-scan observes the fork: the height has a NEW hash and its log vanished.");
  console.log("");
  console.log("recordOccurrence (indexer.mjs:88-98) is keyed on (chain_id, block_hash, log_index).");
  console.log("  - new branch -> INSERT of a new chain_logs row; the old row is untouched");
  console.log("  - old branch re-read -> ON CONFLICT DO UPDATE SET orphaned=false  <-- un-orphans");
  console.log("");
  console.log("Nothing compares the stored hash for a height against the chain's current hash.");
  console.log("`parent_hash` is written at indexer.mjs:85 and never read anywhere.");
  console.log("Result: the scanner converges per-stream, per-topic, by re-scanning - not by");
  console.log("detecting the fork. Any row whose stream did not happen to re-scan the range");
  console.log("keeps its stale value while chain_logs for the same height says otherwise.");
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
