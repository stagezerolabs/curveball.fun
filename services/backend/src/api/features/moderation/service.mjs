import { config } from "../../../platform/config.mjs";
import { pool } from "../../../platform/db.mjs";
import { boundedLimit } from "../../transport/params.mjs";

export function createModeration({ query = (...args) => pool.query(...args), chainId = config.chainId } = {}) {
  return {
    async reports(url) {
      const status = url.searchParams.get("status") || "open";
      if (!new Set(["open", "reviewing", "actioned", "dismissed", "all"]).has(status))
        throw Object.assign(new Error("Unknown report status."), { status: 400 });
      const result = await query(
        `SELECT id,reporter_address,subject_address,subject_trade_id,reason,details,status,
          resolution_note,resolved_at,created_at FROM reports
          WHERE chain_id=$1 AND ($2='all' OR status=$2) ORDER BY created_at ASC LIMIT $3`,
        [chainId, status, boundedLimit(url, 50, 100)],
      );
      return { items: result.rows };
    },
    async updateReport(id, body) {
      const status = typeof body.status === "string" ? body.status : "";
      const resolutionNote = typeof body.resolutionNote === "string"
        ? body.resolutionNote.trim().slice(0, 1_000) : "";
      if (!new Set(["reviewing", "actioned", "dismissed"]).has(status))
        throw Object.assign(new Error("Choose a valid moderation status."), { status: 400 });
      const result = await query(
        `UPDATE reports SET status=$1,resolution_note=$2,
          resolved_at=CASE WHEN $1 IN ('actioned','dismissed') THEN now() ELSE NULL END
          WHERE id=$3 AND chain_id=$4 RETURNING id,status,resolution_note,resolved_at`,
        [status, resolutionNote, id, chainId],
      );
      if (!result.rows[0])
        throw Object.assign(new Error("Report not found."), { status: 404 });
      return result.rows[0];
    },
  };
}

export const moderation = createModeration();
