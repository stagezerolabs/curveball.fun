/** M0 gate. It fails closed and never submits a mainnet transaction. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  http,
  isAddress,
  parseAbi,
  type Address,
} from "viem";

async function main() {
  const rpcUrl = process.env.RISE_RPC_URL || "https://rpc.risechain.com/";
  const factory = process.env.ICARUS_FACTORY as Address | undefined;
  const explorerApi =
    process.env.BLOCKSCOUT_API || "https://explorer.risechain.com/api";
  const output = resolve(
    process.cwd(),
    process.env.VERIFY_OUTPUT || "../deployments/4153/icarus-verification.json",
  );
  if (!factory || !isAddress(factory))
    throw new Error(
      "Set ICARUS_FACTORY to the candidate Icarus V2 factory address; it is deliberately not hardcoded.",
    );
  const abi = parseAbi([
    "function implementation() view returns (address)",
    "function isPaused() view returns (bool)",
    "function pauser() view returns (address)",
    "function feeManager() view returns (address)",
    "function voter() view returns (address)",
    "function volatileFee() view returns (uint256)",
    "function stableFee() view returns (uint256)",
    "function MAX_FEE() view returns (uint256)",
    "function getPool(address,address,bool) view returns (address)",
    "function createPool(address,address,bool) returns (address)",
    "function isPool(address) view returns (bool)",
    "function getFee(address,bool) view returns (uint256)",
  ]);
  const client = createPublicClient({ transport: http(rpcUrl) });
  const requiredPoolFunctions = [
    "token0",
    "token1",
    "stable",
    "getReserves",
    "mint",
    "burn",
    "skim",
    "sync",
    "claimFees",
    "totalSupply",
  ];
  function sourceContent(source: string, suffix: string) {
    try {
      const parsed = JSON.parse(
        source.startsWith("{{") ? source.slice(1, -1) : source,
      ) as { sources?: Record<string, { content?: string }> };
      const match = Object.entries(parsed.sources || {}).find(([path]) =>
        path.endsWith(suffix),
      );
      return match?.[1].content || source;
    } catch {
      return source;
    }
  }
  function unifiedDiff(reference: string, candidate: string, name: string) {
    const a = reference.split("\n");
    const b = candidate.split("\n");
    const out = [`--- aerodrome/${name}`, `+++ icarus/${name}`];
    let i = 0;
    let j = 0;
    // Deliberately simple complete line comparison: it records every non-identical line for review.
    while (i < a.length || j < b.length) {
      if (a[i] === b[j]) {
        i++;
        j++;
        continue;
      }
      if (i < a.length) out.push(`-${a[i++]}`);
      if (j < b.length) out.push(`+${b[j++]}`);
    }
    return out.join("\n") + "\n";
  }
  async function sourceFor(address: Address) {
    const url = new URL(explorerApi);
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "getsourcecode");
    url.searchParams.set("address", address);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Blockscout source request failed: ${response.status}`);
    const body = (await response.json()) as {
      result?: Array<{ SourceCode?: string; ContractName?: string }>;
    };
    const result = body.result?.[0];
    if (
      !result?.SourceCode ||
      result.SourceCode === "0x" ||
      result.SourceCode.trim() === ""
    )
      throw new Error(
        `Source is not verified for ${address}. STOP: do not integrate Icarus.`,
      );
    return result;
  }
  async function read(functionName: any) {
    try {
      return {
        ok: true,
        value: await client.readContract({
          address: factory!,
          abi,
          functionName,
        }),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const factorySource = await sourceFor(factory);
  const implementation = await read("implementation");
  if (!implementation.ok || !isAddress(implementation.value as string))
    throw new Error(
      "Factory does not return a readable implementation(); STOP.",
    );
  const implementationSource = await sourceFor(implementation.value as Address);
  const reads = Object.fromEntries(
    await Promise.all(
      [
        "isPaused",
        "pauser",
        "feeManager",
        "voter",
        "volatileFee",
        "stableFee",
        "MAX_FEE",
      ].map(async (name) => [name, await read(name)]),
    ),
  );
  const missing = Object.entries(reads)
    .filter(([, value]: any) => !value.ok)
    .map(([name]) => name);
  if (missing.length)
    throw new Error(
      `Factory ABI mismatch; unreadable required members: ${missing.join(", ")}. STOP.`,
    );
  const upstream = await Promise.all(
    [
      ["PoolFactory.sol", "factories/PoolFactory.sol"],
      ["Pool.sol", "Pool.sol"],
    ].map(async ([file, path]) => {
      const response = await fetch(
        `https://raw.githubusercontent.com/aerodrome-finance/contracts/main/contracts/${path}`,
      );
      return {
        file,
        ok: response.ok,
        source: response.ok ? await response.text() : "",
      };
    }),
  );
  if (upstream.some((file) => !file.ok))
    throw new Error(
      "Could not fetch Aerodrome reference sources; no comparison report written.",
    );
  const factoryContract = sourceContent(
    factorySource.SourceCode,
    "PoolFactory.sol",
  );
  const implementationContract = sourceContent(
    implementationSource.SourceCode,
    "Pool.sol",
  );
  const sourceText = `${factoryContract}\n${implementationContract}`;
  const absentPoolMethods = requiredPoolFunctions.filter(
    (method) => !sourceText.includes(method),
  );
  const diff =
    unifiedDiff(upstream[0].source, factoryContract, "PoolFactory.sol") +
    unifiedDiff(upstream[1].source, implementationContract, "Pool.sol");
  const report = {
    generatedAt: new Date().toISOString(),
    chainId: 4153,
    candidateFactory: factory,
    rpcUrl,
    verification: {
      factory: { contractName: factorySource.ContractName, verified: true },
      implementation: {
        address: implementation.value,
        contractName: implementationSource.ContractName,
        verified: true,
      },
    },
    factoryReads: reads,
    assumedPoolMethodsMissingFromVerifiedSource: absentPoolMethods,
    aerodromeComparison: {
      reference: "aerodrome-finance/contracts main",
      diffFile: "icarus-vs-aerodrome.diff",
      changedLines: diff
        .split("\n")
        .filter((line) => line.startsWith("+") || line.startsWith("-")).length,
      status: "REVIEW_THE_ARCHIVED_DIFF_BEFORE_INTEGRATION",
    },
    forkCreatePoolCheck:
      "NOT_RUN. Run only on a local fork with two freshly deployed throwaway ERC20s; this script intentionally never sends a mainnet transaction.",
    wethVerification:
      "NOT_RUN. Identify WETH by inspecting verified token contracts and live Icarus pools; never assume an OP-stack predeploy.",
    decision: "STOP_FOR_HUMAN_REVIEW",
  };
  const json =
    JSON.stringify(
      report,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ) + "\n";
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, json);
  await writeFile(
    resolve(dirname(output), "factory-verified-source.sol"),
    factorySource.SourceCode,
  );
  await writeFile(
    resolve(dirname(output), "implementation-verified-source.sol"),
    implementationSource.SourceCode,
  );
  await writeFile(resolve(dirname(output), "icarus-vs-aerodrome.diff"), diff);
  console.log(json);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
