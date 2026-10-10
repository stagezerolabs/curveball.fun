import { MAX_ARTWORK_BYTES } from "./artworkMessage";

export async function uploadArtwork(file, { name, symbol }) {
  if (file.size > MAX_ARTWORK_BYTES || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image under 2 MB.");
  }
  const form = new FormData();
  form.set("artwork", file);
  form.set("name", name);
  form.set("symbol", symbol);
  const response = await fetch("/api/artwork", { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.uri !== "string") {
    throw new Error(typeof data.error === "string" ? data.error : "Artwork upload failed. Try again.");
  }
  return data.uri;
}
