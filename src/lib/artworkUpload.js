import { MAX_ARTWORK_BYTES } from "./artworkRules";

const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{20,})$/i;

async function postArtwork(form, signal) {
  const response = await fetch("/api/artwork", { method: "POST", body: form, signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Artwork upload failed. Try again.");
  }
  return data;
}

export async function uploadArtworkImage(file, { signal } = {}) {
  if (file.size === 0 || file.size > MAX_ARTWORK_BYTES || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image under 2 MB.");
  }
  const form = new FormData();
  form.set("kind", "image");
  form.set("artwork", file);
  const data = await postArtwork(form, signal);
  if (typeof data.cid !== "string" || !CID.test(data.cid)) throw new Error("Artwork upload did not return a valid IPFS hash.");
  return data.cid;
}

export async function publishTokenMetadata(imageCid, { name, symbol, signal }) {
  if (!CID.test(imageCid)) throw new Error("Artwork has no valid IPFS hash.");
  const form = new FormData();
  form.set("kind", "metadata");
  form.set("imageCid", imageCid);
  form.set("name", name.trim());
  form.set("symbol", symbol.trim().toUpperCase());
  const data = await postArtwork(form, signal);
  if (typeof data.uri !== "string" || !data.uri.startsWith("ipfs://") || !CID.test(data.uri.slice(7))) {
    throw new Error("Token metadata did not return a valid IPFS URI.");
  }
  return data.uri;
}
