import { describe, expect, test } from "bun:test";
import { claimProfile } from "./profiles.mjs";

describe("profile claims", () => {
  test("signing in claims the wallet's profile without overwriting an existing one", async () => {
    const queries = [];
    const db = {
      query: async (text, values) => {
        queries.push({ text, values });
        return { rowCount: 1 };
      },
    };

    await claimProfile(
      db,
      11155931,
      "0x5cc42e772f67089b4670eec4dcd904be2f2d511c",
    );

    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(
      /INSERT INTO profiles \(chain_id, ?address\)/,
    );
    expect(queries[0].text).toMatch(
      /ON CONFLICT \(chain_id, ?address\) DO NOTHING/,
    );
    expect(queries[0].values).toEqual([
      11155931,
      "0x5cc42e772f67089b4670eec4dcd904be2f2d511c",
    ]);
  });
});
