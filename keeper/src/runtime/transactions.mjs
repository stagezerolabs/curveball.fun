/** Returns a receipt, or null while a prior transaction may still land. */
export function createTransactionSender({
  publicClient,
  walletClient,
  logger,
}) {
  return async function send(functionName, address, abi, token) {
    // This wallet sends one transaction at a time to preserve nonce order.
    const [latest, pending] = await Promise.all([
      publicClient.getTransactionCount({
        address: walletClient.account.address,
        blockTag: "latest",
      }),
      publicClient.getTransactionCount({
        address: walletClient.account.address,
        blockTag: "pending",
      }),
    ]);
    if (pending > latest) return null;
    const { request } = await publicClient.simulateContract({
      account: walletClient.account,
      address,
      abi,
      functionName,
      args: token ? [token] : [],
    });
    const hash = await walletClient.writeContract(request);
    logger.info(`${functionName} submitted for ${token}: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 90_000,
    });
    if (receipt.status !== "success")
      throw new Error(`${functionName} reverted: ${hash}`);
    return receipt;
  };
}
