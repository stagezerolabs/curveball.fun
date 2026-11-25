ALTER TABLE "curveball"."markets" ADD COLUMN "slug" text;--> statement-breakpoint
WITH bases AS (
  SELECT chain_id,token_address,launch_block,launch_log_index,
    COALESCE(
      NULLIF(TRIM(BOTH '-' FROM LEFT(LOWER(REGEXP_REPLACE(symbol, '[^A-Za-z0-9]+', '-', 'g')), 80)), ''),
      'token'
    ) AS base
  FROM "curveball"."markets"
), ranked AS (
  SELECT chain_id,token_address,base,
    ROW_NUMBER() OVER (
      PARTITION BY chain_id,base
      ORDER BY launch_block ASC NULLS LAST,launch_log_index ASC,token_address ASC
    ) AS position
  FROM bases
)
UPDATE "curveball"."markets" AS market
SET slug=CASE WHEN ranked.position=1 THEN ranked.base
  ELSE ranked.base||'--'||LOWER(SUBSTRING(ranked.token_address FROM 3)) END
FROM ranked
WHERE market.chain_id=ranked.chain_id AND market.token_address=ranked.token_address;--> statement-breakpoint
ALTER TABLE "curveball"."markets" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "markets_chain_slug_unique" ON "curveball"."markets" USING btree ("chain_id","slug");
