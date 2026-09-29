export function expectedChainId(raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? String(fallback) : raw;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("EXPECTED_CHAIN_ID must be a canonical positive integer.");
  }
  const chainId = Number(value);
  if (!Number.isSafeInteger(chainId)) {
    throw new Error("EXPECTED_CHAIN_ID must be a safe positive integer.");
  }
  return chainId;
}
