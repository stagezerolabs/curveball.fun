import { isAddress, type Address } from "viem";

export type CachedLaunch = { address: Address; creator: Address; graduated: boolean; createdBlock?: string };
export type CachedPayout = { amount: bigint; decimals: number };
type Stored<T> = { value: T; updatedAt: number };
type CacheStorage = Pick<Storage, "getItem" | "setItem">;

function read(key: string, storage?: CacheStorage): Stored<unknown> | null {
  try {
    const raw = (storage ?? window.localStorage).getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("updatedAt" in parsed) || !("value" in parsed)) return null;
    if (typeof parsed.updatedAt !== "number" || !Number.isFinite(parsed.updatedAt) || parsed.updatedAt <= 0) return null;
    return parsed as Stored<unknown>;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown, updatedAt: number, storage?: CacheStorage) {
  try {
    (storage ?? window.localStorage).setItem(key, JSON.stringify({ value, updatedAt }));
  } catch {
    // Storage can be disabled or full; the live query still works.
  }
}

export function readCachedLaunches(key: string, storage?: CacheStorage): Stored<CachedLaunch[]> | null {
  const stored = read(`${key}:launches`, storage);
  if (!stored || !Array.isArray(stored.value) || !stored.value.every((token) =>
    token && typeof token === "object" && isAddress(token.address) && isAddress(token.creator) && typeof token.graduated === "boolean" &&
    (token.createdBlock === undefined || typeof token.createdBlock === "string" && /^\d+$/.test(token.createdBlock))
  )) return null;
  return stored as Stored<CachedLaunch[]>;
}

export function writeCachedLaunches(key: string, value: CachedLaunch[], updatedAt = Date.now(), storage?: CacheStorage) {
  write(`${key}:launches`, value, updatedAt, storage);
}

export function readCachedPayout(key: string, storage?: CacheStorage): Stored<CachedPayout> | null {
  const stored = read(`${key}:payout`, storage);
  const value = stored?.value;
  if (!value || typeof value !== "object" || !("amount" in value) || !("decimals" in value) ||
    typeof value.amount !== "string" || !/^\d+$/.test(value.amount) ||
    typeof value.decimals !== "number" || !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 255) return null;
  return { value: { amount: BigInt(value.amount), decimals: value.decimals }, updatedAt: stored.updatedAt };
}

export function writeCachedPayout(key: string, value: CachedPayout, updatedAt = Date.now(), storage?: CacheStorage) {
  write(`${key}:payout`, { amount: value.amount.toString(), decimals: value.decimals }, updatedAt, storage);
}
