import { signMessage } from "@wagmi/core";
import { artworkMessage, MAX_ARTWORK_BYTES } from "./artworkMessage";
import { activeChainId, wagmiConfig } from "./web3";

export async function uploadArtwork(file, { address, name, symbol }) {
  if (file.size > MAX_ARTWORK_BYTES || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image under 2 MB.");
  }
  const bytes = await file.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const issuedAt = Math.floor(Date.now() / 1000);
  const signature = await signMessage(wagmiConfig, {
    account: address,
    message: artworkMessage({ address, chainId: activeChainId, name, symbol, digest, issuedAt }),
  });
  const form = new FormData();
  form.set("artwork", file);
  form.set("address", address);
  form.set("name", name);
  form.set("symbol", symbol);
  form.set("issuedAt", String(issuedAt));
  form.set("signature", signature);
  const response = await fetch("/api/artwork", { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.uri !== "string") {
    throw new Error(typeof data.error === "string" ? data.error : "Artwork upload failed. Try again.");
  }
  return data.uri;
}
