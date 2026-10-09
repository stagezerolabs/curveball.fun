export const MAX_ARTWORK_BYTES = 2_000_000;

export function artworkMessage({ address, chainId, name, symbol, digest, issuedAt }) {
  return [
    "Curveball token artwork upload",
    `Chain: ${chainId}`,
    `Wallet: ${address.toLowerCase()}`,
    `Name: ${name.trim()}`,
    `Symbol: ${symbol.trim().toUpperCase()}`,
    `SHA-256: ${digest}`,
    `Issued: ${issuedAt}`,
  ].join("\n");
}
