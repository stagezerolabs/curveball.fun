import type { Address } from "viem";

const RISE_MAINNET_CHAIN_ID = 4153;
const RNS_NAME = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.rise$/;

export function parseRnsPrimaryName(payload: unknown, address: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (record.chainId !== RISE_MAINNET_CHAIN_ID) return null;
  if (typeof record.address !== "string" || record.address.toLowerCase() !== address.toLowerCase()) return null;
  if (record.isExpired !== false) return null;
  if (typeof record.primaryName !== "string" || !RNS_NAME.test(record.primaryName)) return null;
  if (typeof record.expiry !== "string" || !/^\d+$/.test(record.expiry)) return null;
  if (BigInt(record.expiry) <= BigInt(Math.floor(Date.now() / 1000))) return null;
  return record.primaryName;
}

export async function fetchRnsPrimaryName(address: Address, signal?: AbortSignal): Promise<string | null> {
  const response = await fetch(`/api/rns/primary/${address}`, { signal });
  if (!response.ok) throw new Error(`RNS lookup failed (${response.status})`);
  return parseRnsPrimaryName(await response.json(), address);
}
