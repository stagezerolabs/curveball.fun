import { MAX_ARTWORK_BYTES } from "../src/lib/artworkMessage.js";

const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{20,})$/i;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

async function pinFile(file, jwt) {
  const form = new FormData();
  form.set("network", "public");
  form.set("file", file);
  const response = await fetch(PINATA_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!response.ok) {
    const error = new Error("Pinata upload failed.");
    error.status = response.status;
    throw error;
  }
  const result = await response.json();
  const cid = result?.data?.cid;
  if (typeof cid !== "string" || !CID.test(cid)) throw new Error("Pinata did not return a valid CID.");
  return cid;
}

export async function POST(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ error: "Invalid request origin." }, 403);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_ARTWORK_BYTES + 100_000) return json({ error: "Artwork is too large." }, 413);
  const jwt = process.env.PINATA_JWT?.trim();
  if (!jwt) return json({ error: "Artwork publishing is not configured yet." }, 503);

  let form;
  try { form = await request.formData(); }
  catch { return json({ error: "Invalid upload request." }, 400); }
  const file = form.get("artwork");
  const name = form.get("name");
  const symbol = form.get("symbol");
  if (!(file instanceof File) || typeof name !== "string" || !name.trim() || new TextEncoder().encode(name.trim()).length > 64 ||
      typeof symbol !== "string" || !/^[a-zA-Z0-9]{1,12}$/.test(symbol.trim()) ||
      file.size === 0 || file.size > MAX_ARTWORK_BYTES) {
    return json({ error: "Invalid artwork upload." }, 400);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = imageType(bytes);
  if (!type || type !== file.type) return json({ error: "Use a PNG, JPEG, or WebP image." }, 400);
  try {
    const imageCid = await pinFile(new File([bytes], `artwork.${type.split("/")[1]}`, { type }), jwt);
    const metadata = { name: name.trim(), symbol: symbol.trim().toUpperCase(), image: `ipfs://${imageCid}` };
    const metadataFile = new File([JSON.stringify(metadata)], "metadata.json", { type: "application/json" });
    const metadataCid = await pinFile(metadataFile, jwt);
    return json({ uri: `ipfs://${metadataCid}` });
  } catch (error) {
    console.error("Artwork publishing failed", { pinataStatus: error?.status ?? null });
    if (error?.status === 401 || error?.status === 403) return json({ error: "Artwork publishing is unavailable. Please try again later." }, 503);
    if (error?.status === 429) return json({ error: "Artwork publishing is busy. Please try again shortly." }, 503);
    return json({ error: "Artwork upload failed. Try again." }, 502);
  }
}

export default { fetch: POST };
