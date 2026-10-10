import { afterEach, expect, test } from "bun:test";
import { uploadArtwork } from "./artworkUpload.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("uploads artwork without asking the wallet to sign", async () => {
  const file = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0])], "art.png", { type: "image/png" });
  let requested = false;
  globalThis.fetch = async (url, options) => {
    requested = true;
    expect(url).toBe("/api/artwork");
    expect(options.body.get("artwork").name).toBe(file.name);
    expect(options.body.get("artwork").size).toBe(file.size);
    expect(options.body.get("signature")).toBeNull();
    return Response.json({ uri: "ipfs://bafkreitest" });
  };
  expect(await uploadArtwork(file, { name: "Demo", symbol: "DEMO" })).toBe("ipfs://bafkreitest");
  expect(requested).toBe(true);
});
