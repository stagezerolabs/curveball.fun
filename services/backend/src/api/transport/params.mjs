import { getAddress, isAddress } from "viem";

export function addressParam(value) {
  return typeof value === "string" && isAddress(value)
    ? getAddress(value).toLowerCase()
    : null;
}

export function boundedLimit(url, fallback = 30, maximum = 100) {
  const value = Number(url.searchParams.get("limit") || fallback);
  return Number.isInteger(value)
    ? Math.min(maximum, Math.max(1, value))
    : fallback;
}

export function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return decoded && typeof decoded === "object" ? decoded : null;
  } catch {
    throw Object.assign(new Error("The pagination cursor is invalid."), {
      status: 400,
    });
  }
}
