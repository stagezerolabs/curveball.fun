import { pool } from "../../../platform/db.mjs";
import { config } from "../../../platform/config.mjs";
import { limitRnsLookup } from "../../transport/rateLimit.mjs";

const RNS_CHAIN_ID = 4153;
const RNS_NAME = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.rise$/;

function shapeRns(address, primaryName, expiresAt) {
  return {
    chainId: RNS_CHAIN_ID,
    address,
    primaryName,
    isExpired: false,
    expiry: String(Math.floor(new Date(expiresAt).getTime() / 1_000)),
  };
}

export async function resolveRns(address, remoteAddress) {
  const cached = await pool.query(
    `SELECT primary_name,status,expires_at FROM rns_cache
    WHERE chain_id=$1 AND address=$2 AND expires_at>now()`,
    [RNS_CHAIN_ID, address],
  );
  if (cached.rows[0])
    return shapeRns(
      address,
      cached.rows[0].status === "resolved" ? cached.rows[0].primary_name : null,
      cached.rows[0].expires_at,
    );
  limitRnsLookup(remoteAddress);

  let primaryName = null;
  let status = "not_found";
  let expiresAt = new Date(Date.now() + 10 * 60_000);
  try {
    const response = await fetch(
      `${config.rnsApiUrl}${address}?chainId=${RNS_CHAIN_ID}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (response.ok) {
      const payload = await response.json();
      const upstreamExpiry =
        typeof payload.expiry === "string" && /^\d+$/.test(payload.expiry)
          ? Number(payload.expiry)
          : 0;
      const valid =
        payload.chainId === RNS_CHAIN_ID &&
        typeof payload.address === "string" &&
        payload.address.toLowerCase() === address &&
        payload.isExpired === false &&
        typeof payload.primaryName === "string" &&
        RNS_NAME.test(payload.primaryName) &&
        upstreamExpiry * 1_000 > Date.now();
      if (valid) {
        primaryName = payload.primaryName;
        status = "resolved";
        expiresAt = new Date(
          Math.min(upstreamExpiry * 1_000, Date.now() + 60 * 60_000),
        );
      }
    } else if (response.status !== 404) {
      throw new Error(`RNS request failed (${response.status}).`);
    }
  } catch {
    status = "error";
    expiresAt = new Date(Date.now() + 2 * 60_000);
  }
  await pool.query(
    `INSERT INTO rns_cache (chain_id,address,primary_name,status,resolved_at,expires_at)
    VALUES ($1,$2,$3,$4,now(),$5) ON CONFLICT (chain_id,address) DO UPDATE SET
    primary_name=EXCLUDED.primary_name,status=EXCLUDED.status,resolved_at=now(),expires_at=EXCLUDED.expires_at,updated_at=now()`,
    [RNS_CHAIN_ID, address, primaryName, status, expiresAt],
  );
  return shapeRns(address, primaryName, expiresAt);
}
