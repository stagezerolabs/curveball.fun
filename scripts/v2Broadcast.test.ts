import { expect, test } from "bun:test";
import { resolveV2Broadcast } from "./v2Broadcast";

const factory = "0x1111111111111111111111111111111111111111";
const deployer = "0x2222222222222222222222222222222222222222";

function broadcastFixture() {
  return {
    transactions: [
      { transactionType: "CREATE", contractName: "CurveLaunchFactory", contractAddress: factory, hash: "0xwrongFactory" },
      { transactionType: "CREATE", contractName: "CurveLaunchDeployer", contractAddress: deployer, hash: "0xwrongDeployer" },
      ...["CurveFeeEscrow", "CurveBuybackVault", "CurveGraduationGuard", "CurveLpLocker", "CurveGraduationExecutor", "CurveMemeHook", "CurveLaunchAndBuy"].map((contractName, i) => ({ transactionType: "CREATE", contractName, contractAddress: `0x${String(i + 3).repeat(40)}`, hash: `0xwrong${i}` })),
      { transactionType: "CALL", contractName: "CurveLaunchFactory", function: "initialize((address,address,address,address,address,address,address,address))", hash: "0xinit", transaction: { to: factory } },
    ],
    receipts: [
      { contractAddress: deployer, transactionHash: "0xrealDeployer", status: "0x1", blockNumber: "0x2" },
      { contractAddress: factory, transactionHash: "0xrealFactory", status: "0x1", blockNumber: "0x1" },
      ...["3", "4", "5", "6", "7", "8", "9"].map((n) => ({ contractAddress: `0x${n.repeat(40)}`, transactionHash: `0xreal${n}`, status: "0x1", blockNumber: "0x2" })),
      { contractAddress: null, transactionHash: "0xinit", status: "0x1", blockNumber: "0x2" },
    ],
  };
}

test("V2 broadcast recording matches successful receipts by deployed address, not Forge transaction hash", () => {
  const result = resolveV2Broadcast(broadcastFixture());
  expect(result.creates[0]).toMatchObject({ name: "CurveLaunchFactory", address: factory, hash: "0xrealFactory" });
  expect(result.creates[1]).toMatchObject({ name: "CurveLaunchDeployer", address: deployer, hash: "0xrealDeployer" });
  expect(result.initializeHash).toBe("0xinit");
});

test("V2 broadcast recording rejects a failed or missing creation receipt", () => {
  const failed = broadcastFixture();
  failed.receipts[0].status = "0x0";
  expect(() => resolveV2Broadcast(failed)).toThrow("No successful receipt for CurveLaunchDeployer");
  const missing = broadcastFixture();
  missing.receipts.shift();
  expect(() => resolveV2Broadcast(missing)).toThrow("No successful receipt for CurveLaunchDeployer");
});
