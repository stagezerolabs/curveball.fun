import { getAddress, type Address } from "viem";

const expectedNames = [
  "CurveLaunchFactory", "CurveLaunchDeployer", "CurveFeeEscrow", "CurveBuybackVault",
  "CurveGraduationGuard", "CurveLpLocker", "CurveGraduationExecutor", "CurveMemeHook", "CurveLaunchAndBuy",
] as const;

type BroadcastTransaction = {
  transactionType: string;
  contractName: string;
  contractAddress?: string;
  hash: string;
  function?: string;
  transaction?: { to?: string | null };
};
type BroadcastReceipt = {
  contractAddress?: string | null;
  transactionHash: string;
  status: string;
  blockNumber: string;
};

export function resolveV2Broadcast(broadcast: { transactions: BroadcastTransaction[]; receipts: BroadcastReceipt[] }) {
  const creations = broadcast.transactions.filter((tx) => tx.transactionType === "CREATE");
  if (creations.length !== expectedNames.length || creations.some((tx, i) => tx.contractName !== expectedNames[i])) {
    throw new Error("Broadcast does not contain the ordered V2 deployment.");
  }
  const receiptsByAddress = new Map<string, BroadcastReceipt>();
  for (const receipt of broadcast.receipts) {
    if (!receipt.contractAddress) continue;
    const address = getAddress(receipt.contractAddress).toLowerCase();
    if (receiptsByAddress.has(address)) throw new Error(`Duplicate creation receipt for ${address}.`);
    receiptsByAddress.set(address, receipt);
  }
  const creates = creations.map((tx, i) => {
    if (!tx.contractAddress) throw new Error(`Missing ${tx.contractName} address.`);
    const address = getAddress(tx.contractAddress);
    const receipt = receiptsByAddress.get(address.toLowerCase());
    if (!receipt || receipt.status !== "0x1" || !receipt.transactionHash || !receipt.blockNumber) {
      throw new Error(`No successful receipt for ${tx.contractName} at ${address}.`);
    }
    return { name: expectedNames[i], address, hash: receipt.transactionHash, blockNumber: BigInt(receipt.blockNumber) };
  });
  const factory = creates[0].address;
  const initialization = broadcast.transactions.find((tx) =>
    tx.transactionType === "CALL" && tx.contractName === "CurveLaunchFactory"
      && tx.function?.startsWith("initialize(") && tx.transaction?.to && getAddress(tx.transaction.to) === factory
  );
  const initializeReceipt = broadcast.receipts.find((receipt) => receipt.transactionHash === initialization?.hash);
  if (!initializeReceipt || initializeReceipt.status !== "0x1" || initializeReceipt.contractAddress) {
    throw new Error("No successful factory initialization receipt.");
  }
  return { creates, initializeHash: initializeReceipt.transactionHash, factory: factory as Address };
}
