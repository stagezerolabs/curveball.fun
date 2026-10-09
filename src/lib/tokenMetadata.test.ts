import { afterEach, expect, test } from "bun:test";
import { publicContentUrl, tokenArtworkUrl } from "./tokenMetadata";

const cid = `bafy${"a".repeat(55)}`;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("only resolves HTTPS and valid IPFS paths", () => {
  expect(publicContentUrl(`ipfs://${cid}`)).toBe(`https://gateway.pinata.cloud/ipfs/${cid}`);
  expect(publicContentUrl("javascript:alert(1)")).toBeNull();
  expect(publicContentUrl("ipfs://bad-cid")).toBeNull();
});

test("reads the image recorded in token metadata", async () => {
  let calls = 0;
  globalThis.fetch = (async (url) => {
    calls += 1;
    expect(url).toBe(`https://gateway.pinata.cloud/ipfs/${cid}`);
    return Response.json({ image: `ipfs://${cid}` });
  }) as typeof fetch;
  expect(await tokenArtworkUrl(`ipfs://${cid}`)).toBe(`https://gateway.pinata.cloud/ipfs/${cid}`);
  expect(await tokenArtworkUrl(`ipfs://${cid}`)).toBe(`https://gateway.pinata.cloud/ipfs/${cid}`);
  expect(calls).toBe(1);
});

test("ignores oversized or unsafe metadata", async () => {
  globalThis.fetch = (async () => new Response("x".repeat(32_001))) as unknown as typeof fetch;
  expect(await tokenArtworkUrl(`ipfs://bafy${"c".repeat(55)}`)).toBeNull();
  globalThis.fetch = (async () => Response.json({ image: "javascript:alert(1)" })) as unknown as typeof fetch;
  expect(await tokenArtworkUrl(`ipfs://bafy${"d".repeat(55)}`)).toBeNull();
});
