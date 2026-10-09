const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{20,})(\/[^\s?#]*)?$/i;
const MAX_METADATA_BYTES = 32_000;
const cache = new Map<string, Promise<string | null>>();

async function readMetadata(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get("content-length")) > MAX_METADATA_BYTES) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_METADATA_BYTES) return null;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

export function publicContentUrl(uri: string): string | null {
  if (uri.startsWith("ipfs://")) {
    const path = uri.slice(7);
    return CID.test(path) ? `https://gateway.pinata.cloud/ipfs/${path}` : null;
  }
  try {
    const url = new URL(uri);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function tokenArtworkUrl(uri: string): Promise<string | null> {
  const existing = cache.get(uri);
  if (existing) return existing;
  const metadataUrl = publicContentUrl(uri);
  if (!metadataUrl) return Promise.resolve(null);
  const request = (async () => {
    try {
      const response = await fetch(metadataUrl, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return null;
      const metadata = await readMetadata(response);
      if (!metadata || typeof metadata !== "object") return null;
      const image = "image" in metadata ? metadata.image : null;
      return typeof image === "string" ? publicContentUrl(image) : null;
    } catch {
      return null;
    }
  })();
  cache.set(uri, request);
  void request.then((url) => { if (!url) cache.delete(uri); });
  return request;
}
