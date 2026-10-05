// VITE_STAGE0_RNS_BASE_URL may override the public browser API endpoint.
const DEFAULT_BASE_URL = "https://rns.stage0.xyz/v1";
const CACHE_MS = 15_000;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const NAME_PATTERN = /^[a-z0-9-]{1,32}\.rise$/;

export type RiseName = {
  name: string;
  custody: string | null;
  resolvedAddress: `0x${string}` | null;
  expiresAt: string | null;
};

export type UserRiseIdentity = {
  address: string;
  displayName: string | null;
  names: RiseName[];
  indexedAt: string | null;
};

type RnsClientOptions = {
  baseUrl?: string;
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  timeoutMs?: number;
  log?: (message: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && NAME_PATTERN.test(value);
}

function fallback(address: string): UserRiseIdentity {
  return { address, displayName: null, names: [], indexedAt: null };
}

export function shortenAddress(address: string): string {
  return isAddress(address) ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;
}

function optionalString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function parseReverse(value: unknown, address: string): UserRiseIdentity | null {
  if (
    !isRecord(value) ||
    value.chainId !== 4153 ||
    !isAddress(value.address) ||
    value.address.toLowerCase() !== address.toLowerCase() ||
    !(value.primaryName === null || isName(value.primaryName)) ||
    (value.isExpired !== undefined && value.isExpired !== null && typeof value.isExpired !== "boolean") ||
    (value.resolvedAddress !== undefined && value.resolvedAddress !== null && !isAddress(value.resolvedAddress)) ||
    !optionalString(value.lastIndexedAt)
  ) return null;

  const validName = value.primaryName !== null &&
    value.isExpired !== true &&
    (value.resolvedAddress === undefined || value.resolvedAddress === null ||
      value.resolvedAddress.toLowerCase() === address.toLowerCase());

  return {
    address,
    displayName: validName ? value.primaryName as string : null,
    names: [],
    indexedAt: value.lastIndexedAt ?? null,
  };
}

function parseOwned(value: unknown, address: string): UserRiseIdentity | null {
  if (
    !isRecord(value) || value.chainId !== 4153 || !isAddress(value.owner) ||
    value.owner.toLowerCase() !== address.toLowerCase() ||
    !Number.isInteger(value.count) || (value.count as number) < 0 ||
    !Array.isArray(value.names) || value.names.length !== value.count
  ) return null;

  const names: RiseName[] = [];
  let indexedAt: string | null = null;
  for (const item of value.names) {
    if (!isRecord(item)) return null;
    const name = item.name ?? item.fqdn;
    if (
      !isName(name) ||
      (item.owner !== undefined && (!isAddress(item.owner) || item.owner.toLowerCase() !== address.toLowerCase())) ||
      (item.resolvedAddress !== undefined && item.resolvedAddress !== null && !isAddress(item.resolvedAddress)) ||
      (item.expiry !== undefined && item.expiry !== null && (typeof item.expiry !== "string" || !/^\d+$/.test(item.expiry))) ||
      (item.isExpired !== undefined && item.isExpired !== null && typeof item.isExpired !== "boolean") ||
      !optionalString(item.custody) || !optionalString(item.lastIndexedAt)
    ) return null;
    if (item.isExpired === true) continue;
    names.push({
      name,
      custody: item.custody ?? null,
      resolvedAddress: item.resolvedAddress ?? null,
      expiresAt: item.expiry ?? null,
    });
    indexedAt ??= item.lastIndexedAt ?? null;
  }
  return { address, displayName: null, names, indexedAt };
}

function retryAfterMs(value: string | null, now: number): number {
  if (!value) return CACHE_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? CACHE_MS : Math.max(1_000, date - now);
}

export function createRnsClient(options: RnsClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? import.meta.env.VITE_STAGE0_RNS_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const log = options.log ?? ((message: string) => console.warn(message));
  const cache = new Map<string, { identity: UserRiseIdentity; expiresAt: number }>();
  const inFlight = new Map<string, Promise<UserRiseIdentity>>();
  let rateLimitedUntil = 0;

  async function read(kind: "reverse" | "owned", address: string): Promise<UserRiseIdentity> {
    const empty = fallback(address);
    if (!isAddress(address)) {
      log(`Stage0 RNS invalid address: ${address}`);
      return empty;
    }
    if (now() < rateLimitedUntil) return empty;
    const key = `${kind}:${address.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached && now() < cached.expiresAt) return cached.identity;
    const pending = inFlight.get(key);
    if (pending) return pending;

    const request = (async (): Promise<UserRiseIdentity> => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const path = kind === "reverse" ? `reverse/${address}` : `addresses/${address}/names`;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("timeout"));
          }, timeoutMs);
        });
        const response = await Promise.race([
          fetchFn(`${baseUrl}/${path}`, { signal: controller.signal }),
          timeout,
        ]);
        const requestId = response.headers.get("X-Request-Id");
        if (response.status === 429) {
          rateLimitedUntil = Math.max(rateLimitedUntil, now() + retryAfterMs(response.headers.get("Retry-After"), now()));
        }
        let body: unknown;
        try {
          body = await Promise.race([response.json(), timeout]);
        } catch {
          if (controller.signal.aborted) throw new Error("timeout");
          log(`Stage0 RNS HTTP ${response.status} requestId=${requestId ?? "unknown"} invalid JSON`);
          return empty;
        }
        if (!response.ok) {
          const bodyId = isRecord(body) && typeof body.requestId === "string" ? body.requestId : null;
          log(`Stage0 RNS HTTP ${response.status} requestId=${requestId ?? bodyId ?? "unknown"}`);
          return empty;
        }
        const identity = kind === "reverse" ? parseReverse(body, address) : parseOwned(body, address);
        if (!identity) {
          log(`Stage0 RNS HTTP ${response.status} requestId=${requestId ?? "unknown"} schema mismatch`);
          return empty;
        }
        cache.set(key, { identity, expiresAt: now() + CACHE_MS });
        return identity;
      } catch (error) {
        log(`Stage0 RNS request failed: ${error instanceof Error ? error.message : String(error)}`);
        return empty;
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    inFlight.set(key, request);
    try {
      return await request;
    } finally {
      inFlight.delete(key);
    }
  }

  return {
    getReverse: (address: string) => read("reverse", address),
    getOwnedNames: (address: string) => read("owned", address),
    getWalletLabel: async (address: string) => {
      const identity = await read("reverse", address);
      return identity.displayName ?? shortenAddress(address);
    },
  };
}

export const rnsClient = createRnsClient();
