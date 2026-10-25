import { afterEach, expect, test } from "bun:test";
import { publishTokenMetadata, uploadArtworkImage } from "./artworkUpload.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("publishes an image and metadata without a wallet signature", async () => {
  const imageCid = "bafk" + "a".repeat(55);
  const metadataCid = "bafk" + "b".repeat(55);
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return Response.json(
      requests.length === 1
        ? { cid: imageCid }
        : { uri: `ipfs://${metadataCid}` },
    );
  };

  const file = new File(["image"], "image.png", { type: "image/png" });
  const cid = await uploadArtworkImage(file);
  const uri = await publishTokenMetadata(cid, {
    name: " Demo ",
    symbol: "punk",
  });

  expect(uri).toBe(`ipfs://${metadataCid}`);
  expect(requests.map(({ url }) => url)).toEqual([
    "/api/artwork",
    "/api/artwork",
  ]);
  expect(requests[0].options.body.get("kind")).toBe("image");
  expect(requests[0].options.body.get("artwork").name).toBe(file.name);
  expect(requests[0].options.body.get("artwork").type).toBe(file.type);
  expect(requests[1].options.body.get("kind")).toBe("metadata");
  expect(requests[1].options.body.get("imageCid")).toBe(imageCid);
  expect(requests[1].options.body.get("name")).toBe("Demo");
  expect(requests[1].options.body.get("symbol")).toBe("PUNK");
  expect(requests[0].options.body.get("signature")).toBeNull();
  expect(requests[1].options.body.get("signature")).toBeNull();
});

test("rejects an invalid image before sending an upload request", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };
  await expect(
    uploadArtworkImage(
      new File(["image"], "image.svg", { type: "image/svg+xml" }),
    ),
  ).rejects.toThrow("Choose a PNG, JPEG, or WebP image under 2 MB.");
  expect(called).toBe(false);
});
