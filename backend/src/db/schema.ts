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
    amount: text().notNull(),
    tx: text().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("trades_event_key_unique").on(table.eventKey),
    index("trades_token_idx")
      .on(table.token)
      .where(sql`${table.deletedAt} IS NULL`),
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
