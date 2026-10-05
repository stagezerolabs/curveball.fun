import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

export const tokens = pgTable(
  "tokens",
  {
    id: uuid().defaultRandom().primaryKey(),
    address: text().notNull(),
    deployment: text(),
    curve: text(),
    name: text().notNull(),
    symbol: text().notNull(),
    creator: text().notNull(),
    graduated: boolean().default(false).notNull(),
    pool: text(),
    imageUrl: text("image_url"),
    description: text(),
    website: text(),
    xHandle: text("x_handle"),
    telegram: text(),
    // Quote-side liquidity moved to the Icarus pool at graduation, in wei.
    // Emitted by Graduated(); null until a token graduates.
    quoteLiquidity: text("quote_liquidity"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tokens_address_unique").on(table.address),
    index("tokens_graduated_idx")
      .on(table.graduated)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const trades = pgTable(
  "trades",
  {
    id: uuid().defaultRandom().primaryKey(),
    eventKey: text("event_key").notNull(),
    token: text().notNull(),
    trader: text().notNull(),
    side: text().notNull(),
    quote: text().notNull(),
    grossCurveQuote: text("gross_curve_quote"),
    feeQuote: text("fee_quote"),
    creatorTaxQuote: text("creator_tax_quote"),
    amount: text().notNull(),
    tx: text().notNull(),
    // Chain time, not row-insert time. Every time-windowed metric (24h volume,
    // 24h change, price history) reads this — created_at is only a fallback for
    // rows indexed before these columns existed, and is wrong for any backfill.
    blockNumber: text("block_number"),
    blockTime: timestamp("block_time", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("trades_event_key_unique").on(table.eventKey),
    index("trades_token_idx")
      .on(table.token)
      .where(sql`${table.deletedAt} IS NULL`),
    index("trades_token_time_idx").on(table.token, table.blockTime),
  ],
);

export const indexerState = pgTable(
  "indexer_state",
  {
    id: uuid().defaultRandom().primaryKey(),
    key: text().notNull(),
    value: text().notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("indexer_state_key_unique").on(table.key)],
);

export const protocolEvents = pgTable(
  "protocol_events",
  {
    id: uuid().defaultRandom().primaryKey(),
    eventKey: text("event_key").notNull(),
    deployment: text().notNull(),
    launch: text().notNull(),
    kind: text().notNull(),
    asset: text(),
    recipient: text(),
    amount: text(),
    tx: text().notNull(),
    blockNumber: text("block_number").notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("protocol_events_event_key_unique").on(table.eventKey),
    index("protocol_events_launch_time_idx").on(table.launch, table.blockTime),
  ],
);
