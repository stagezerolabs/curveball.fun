import { config } from "./config.mjs";
import { pool } from "./db.mjs";
import { traceBackendTask } from "./instrument.mjs";

const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{20,})(\/[^\s]*)?$/i;
const MAX_METADATA_BYTES = 256 * 1024;

function publicUrl(uri, enforceHost = false) {
  if (typeof uri !== "string" || !uri) return null;
  if (uri.startsWith("ipfs://")) {
    const path = uri.slice(7);
    return CID.test(path) ? `${config.ipfsGateway}${path}` : null;
  }
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "https:") return null;
    if (enforceHost && !config.metadataHosts.has(parsed.hostname.toLowerCase())) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function shortString(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : null;
}

async function fetchMetadata(uri) {
  const url = publicUrl(uri, true);
  if (!url) return null;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Metadata request failed (${response.status}).`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_METADATA_BYTES) throw new Error("Metadata document is too large.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_METADATA_BYTES) throw new Error("Metadata document is too large.");
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Metadata must be a JSON object.");
  return {
    name: shortString(value.name, 120),
    description: shortString(value.description, 1_000),
    imageUrl: publicUrl(value.image),
    externalUrl: publicUrl(value.external_url),
  };
}

export async function refreshMetadataBatch() {
  const candidates = await pool.query(`SELECT chain_id,address,metadata_uri FROM assets
    WHERE metadata_uri IS NOT NULL AND metadata_uri<>''
      AND (metadata_fetched_at IS NULL OR metadata_fetched_at<now()-interval '24 hours')
    ORDER BY metadata_fetched_at ASC NULLS FIRST LIMIT 20`);
  for (const asset of candidates.rows) {
    try {
      const metadata = await fetchMetadata(asset.metadata_uri);
      await pool.query(`UPDATE assets SET metadata=$1::jsonb,metadata_fetched_at=now(),updated_at=now()
        WHERE chain_id=$2 AND address=$3`, [JSON.stringify(metadata), asset.chain_id, asset.address]);
    } catch (error) {
      await pool.query(`UPDATE assets SET metadata_fetched_at=now(),updated_at=now()
        WHERE chain_id=$1 AND address=$2`, [asset.chain_id, asset.address]);
      console.warn(`Metadata refresh failed for ${asset.address}:`, error instanceof Error ? error.message : error);
    }
  }
  return candidates.rowCount;
}

export function startMetadataWorker({ onError } = {}) {
  let stopped = false;
  let timer;
  const tick = async () => traceBackendTask("social.metadata.tick", async () => {
    try {
      let refreshed;
      do {
        refreshed = stopped ? 0 : await refreshMetadataBatch();
      } while (refreshed === 20 && !stopped);
    } catch (error) {
      onError?.(error);
    } finally {
      if (!stopped) timer = setTimeout(tick, config.metadataRefreshMs);
    }
  });
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
