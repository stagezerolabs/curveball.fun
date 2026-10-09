import { afterEach, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { createHash } from "node:crypto";
import { artworkMessage } from "../src/lib/artworkMessage.js";
import { POST } from "./artwork.js";

const account = privateKeyToAccount("0x" + "1".repeat(64));
const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0])], "test.png", { type: "image/png" });
const originalFetch = globalThis.fetch;
const originalJwt = process.env.PINATA_JWT;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalJwt === undefined) delete process.env.PINATA_JWT;
  else process.env.PINATA_JWT = originalJwt;
});

async function request({ file = png, signature, issuedAt = Math.floor(Date.now() / 1000), origin = "https://curveball.test" } = {}) {
  const form = new FormData();
  form.set("artwork", file);
  form.set("address", account.address);
  form.set("name", "Demo");
  form.set("symbol", "DEMO");
  form.set("issuedAt", String(issuedAt));
  form.set("signature", signature ?? "0x" + "0".repeat(130));
  return POST(new Request("https://curveball.test/api/artwork", { method: "POST", headers: { Origin: origin }, body: form }));
}

test("rejects unsigned uploads before calling Pinata", async () => {
  process.env.PINATA_JWT = "test-token";
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  expect((await request()).status).toBe(403);
  expect((await request({ issuedAt: 1 })).status).toBe(400);
  expect((await request({ origin: "https://elsewhere.test" })).status).toBe(403);
  expect(calls).toBe(0);
});

test("rejects a file whose bytes do not match its image type", async () => {
  process.env.PINATA_JWT = "test-token";
  const file = new File(["not an image"], "fake.png", { type: "image/png" });
  expect((await request({ file })).status).toBe(400);
});

test("pins an image and its metadata with the signed wallet", async () => {
  process.env.PINATA_JWT = "test-token";
  const issuedAt = Math.floor(Date.now() / 1000);
  const digest = createHash("sha256").update(Buffer.from(await png.arrayBuffer())).digest("hex");
  const signature = await account.signMessage({ message: artworkMessage({ address: account.address, chainId: 11155931, name: "Demo", symbol: "DEMO", digest, issuedAt }) });
  const cids = ["bafy" + "a".repeat(55), "bafy" + "b".repeat(55)];
  const uploads = [];
  globalThis.fetch = async (url, options) => {
    expect(url).toBe("https://uploads.pinata.cloud/v3/files");
    expect(options.headers.Authorization).toBe("Bearer test-token");
    expect(options.body.get("network")).toBe("public");
    const uploadedFile = options.body.get("file");
    uploads.push(uploads.length === 1 ? JSON.parse(await uploadedFile.text()).image : null);
    return Response.json({ data: { cid: cids[uploads.length - 1] } });
  };
  const response = await request({ signature, issuedAt });
  expect(response.status).toBe(200);
  expect((await response.json()).uri).toBe(`ipfs://${cids[1]}`);
  expect(uploads).toEqual([null, `ipfs://${cids[0]}`]);
});
