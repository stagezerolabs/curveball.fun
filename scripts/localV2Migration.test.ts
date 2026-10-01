import { expect, test } from "bun:test";
import { assertLocalV2MigrationTarget } from "./localV2Migration";

const env = {
  DATABASE_URL: "postgresql://curveball:local-dev-password@127.0.0.1:5433/curveball",
  DATABASE_SSL: "false",
  EXPECTED_CHAIN_ID: "11155931",
  CONTRACT_VERSION: "v2",
  LAUNCHPAD_ADDRESS: "0x36628AbAC7B2cdcde1A8fa21868AfeCB74660ECf",
  INDEXER_START_BLOCK: "55636468",
};

test("local V2 migration accepts only the Compose database and recorded deployment", () => {
  expect(() => assertLocalV2MigrationTarget(env)).not.toThrow();
  for (const databaseUrl of [
    "postgresql://curveball:secret@neon.example:5433/curveball",
    "postgresql://curveball:secret@127.0.0.1:55434/curveball",
    "postgresql://curveball:secret@127.0.0.1:5433/other",
    "postgresql://postgres:secret@127.0.0.1:5433/curveball",
    "postgresql://curveball:secret@127.0.0.1:5433/curveball?sslmode=require",
  ]) {
    expect(() => assertLocalV2MigrationTarget({ ...env, DATABASE_URL: databaseUrl })).toThrow();
  }
  expect(() => assertLocalV2MigrationTarget({ ...env, CONTRACT_VERSION: "v1" })).toThrow();
  expect(() => assertLocalV2MigrationTarget({ ...env, EXPECTED_CHAIN_ID: "4153" })).toThrow();
  expect(() => assertLocalV2MigrationTarget({ ...env, LAUNCHPAD_ADDRESS: "0x1111111111111111111111111111111111111111" })).toThrow();
  expect(() => assertLocalV2MigrationTarget({ ...env, DATABASE_SSL: "true" })).toThrow();
});
