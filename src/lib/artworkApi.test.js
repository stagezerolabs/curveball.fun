import { afterEach, expect, test } from "bun:test";
import artworkHandler, { POST } from "../../api/artwork.js";

const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0])], "test.png", { type: "image/png" });
const originalFetch = globalThis.fetch;
const originalJwt = process.env.PINATA_JWT;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalJwt === undefined) delete process.env.PINATA_JWT;
  else process.env.PINATA_JWT = originalJwt;
});

async function request({ file = png, origin = "https://curveball.test" } = {}) {
  const form = new FormData();
  form.set("artwork", file);
  form.set("name", "Demo");
  form.set("symbol", "DEMO");
  return POST(new Request("https://curveball.test/api/artwork", { method: "POST", headers: { Origin: origin }, body: form }));
}

test("rejects requests from another origin before calling Pinata", async () => {
  process.env.PINATA_JWT = "test-token";
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  expect((await request({ origin: "https://elsewhere.test" })).status).toBe(403);
  expect(calls).toBe(0);
});

test("rejects a file whose bytes do not match its image type", async () => {
  process.env.PINATA_JWT = "test-token";
  const file = new File(["not an image"], "fake.png", { type: "image/png" });
  expect((await request({ file })).status).toBe(400);
});

test("pins an image and its metadata without a wallet signature", async () => {
  process.env.PINATA_JWT = "test-token";
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
  const response = await request();
  expect(response.status).toBe(200);
  expect((await response.json()).uri).toBe(`ipfs://${cids[1]}`);
  expect(uploads).toEqual([null, `ipfs://${cids[0]}`]);
});

test("reports rejected Pinata credentials as a publishing outage", async () => {
  process.env.PINATA_JWT = "test-token";
  globalThis.fetch = async () => new Response(null, { status: 401 });
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await request();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("Artwork publishing is unavailable. Please try again later.");
  } finally {
    console.error = originalError;
  }
});

test("exports the Vercel fetch handler", () => {
  expect(artworkHandler.fetch).toBe(POST);
});
