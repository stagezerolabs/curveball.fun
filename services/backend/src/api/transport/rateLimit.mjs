import { config } from "../../platform/config.mjs";
import { clientAddress } from "./clientAddress.mjs";

// Process-local ceiling for authenticated writes; multiple instances need a shared or edge limit.
const socialWriteBuckets = new Map();
let nextSocialWritePruneAt = 0;
export function limitSocialWrite(request, address) {
  const now = Date.now();
  if (now >= nextSocialWritePruneAt) {
    for (const [key, bucket] of socialWriteBuckets) {
      if (bucket.expires <= now) socialWriteBuckets.delete(key);
    }
    nextSocialWritePruneAt = now + 10_000;
  }
  // Socket IP may be the ingress proxy for every viewer, so this is only a
  // coarse process safety ceiling. Wallet limits do the ordinary throttling.
  const limits = [
    [`wallet:${address}`, 30],
    [`ip:${clientAddress(request, config.trustProxyClientIp)}`, 100_000],
  ];
  for (const [key, maximum] of limits) {
    const bucket = socialWriteBuckets.get(key);
    if (bucket && bucket.count >= maximum) {
      throw Object.assign(
        new Error("Too many social actions. Try again shortly."),
        {
          status: 429,
          retryAfter: Math.max(1, Math.ceil((bucket.expires - now) / 1_000)),
        },
      );
    }
  }
  for (const [key] of limits) {
    const bucket = socialWriteBuckets.get(key);
    if (bucket) bucket.count += 1;
    else socialWriteBuckets.set(key, { count: 1, expires: now + 60_000 });
  }
  if (socialWriteBuckets.size > 10_000)
    socialWriteBuckets.delete(socialWriteBuckets.keys().next().value);
}

// Process-local abuse guard for the unauthenticated RNS resolution path. It only counts lookups
// that miss the cache (the path that calls the upstream API); cached answers stay free. On
// mainnet the private API trusts only the client IP overwritten by its edge. This is a coarse
// process safety ceiling; the ingress still needs a rate limit and forwarded-IP verification.
const rnsLookupBuckets = new Map();
const RNS_LOOKUPS_PER_MINUTE = 120;
let nextRnsLookupPruneAt = 0;

export function limitRnsLookup(remoteAddress) {
  const now = Date.now();
  if (now >= nextRnsLookupPruneAt) {
    for (const [key, bucket] of rnsLookupBuckets) {
      if (bucket.expires <= now) rnsLookupBuckets.delete(key);
    }
    nextRnsLookupPruneAt = now + 10_000;
  }
  const key = `ip:${remoteAddress || "unknown"}`;
  const bucket = rnsLookupBuckets.get(key);
  if (bucket && bucket.count >= RNS_LOOKUPS_PER_MINUTE) {
    throw Object.assign(
      new Error("Too many name lookups. Try again shortly."),
      {
        status: 429,
        retryAfter: Math.max(1, Math.ceil((bucket.expires - now) / 1_000)),
      },
    );
  }
  if (bucket) bucket.count += 1;
  else rnsLookupBuckets.set(key, { count: 1, expires: now + 60_000 });
  if (rnsLookupBuckets.size > 10_000)
    rnsLookupBuckets.delete(rnsLookupBuckets.keys().next().value);
}
