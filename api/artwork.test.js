import { afterEach, expect, test } from "bun:test";
import { POST } from "./artwork.js";

const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0])], "test.png", { type: "image/png" });
const originalFetch = globalThis.fetch;
const originalJwt = process.env.PINATA_JWT;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalJwt === undefined) delete process.env.PINATA_JWT;
  else process.env.PINATA_JWT = originalJwt;
});

function request(fields, origin = "https://curveball.test") {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return POST(new Request("https://curveball.test/api/artwork", { method: "POST", headers: { Origin: origin }, body: form }));
}

test("rejects cross-origin and invalid image uploads before Pinata", async () => {
  process.env.PINATA_JWT = "test-token";
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  expect((await request({ kind: "image", artwork: png }, "https://elsewhere.test")).status).toBe(403);
  const fake = new File(["not an image"], "fake.png", { type: "image/png" });
  expect((await request({ kind: "image", artwork: fake })).status).toBe(400);
  expect(calls).toBe(0);
});

test("pins an image without a wallet signature, then pins its token metadata", async () => {
  process.env.PINATA_JWT = "test-token";
  const imageCid = "bafk" + "a".repeat(55);
  const metadataCid = "bafk" + "b".repeat(55);
  const uploads = [];
  globalThis.fetch = async (url, options) => {
    expect(url).toBe("https://uploads.pinata.cloud/v3/files");
    expect(options.headers.Authorization).toBe("Bearer test-token");
    expect(options.body.get("network")).toBe("public");
    const file = options.body.get("file");
    uploads.push(file);
    return Response.json({ data: { cid: uploads.length === 1 ? imageCid : metadataCid } });
  };

  const imageResponse = await request({ kind: "image", artwork: png });
  expect(imageResponse.status).toBe(200);
  expect(await imageResponse.json()).toEqual({ cid: imageCid });

  const metadataResponse = await request({ kind: "metadata", imageCid, name: "Demo", symbol: "demo" });
  expect(metadataResponse.status).toBe(200);
  expect(await metadataResponse.json()).toEqual({ uri: `ipfs://${metadataCid}` });
  expect(JSON.parse(await uploads[1].text())).toEqual({ name: "Demo", symbol: "DEMO", image: `ipfs://${imageCid}` });
});

test("metadata requires a valid pinned image CID and token details", async () => {
  process.env.PINATA_JWT = "test-token";
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  expect((await request({ kind: "metadata", imageCid: "invalid", name: "Demo", symbol: "DEMO" })).status).toBe(400);
  expect((await request({ kind: "metadata", imageCid: "bafy" + "a".repeat(55), name: "", symbol: "DEMO" })).status).toBe(400);
  expect(calls).toBe(0);
});
