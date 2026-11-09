import { expect, test } from "bun:test";
import { configureTestEnvironment } from "../../../helpers/environment.mjs";

configureTestEnvironment();
const { createNotifications } = await import("../../../../src/api/features/notifications/service.mjs");
const alice = "0x0000000000000000000000000000000000000011";

test("marking notifications read accepts only bounded numeric IDs", async () => {
  const calls = [];
  const notifications = createNotifications({
    chainId: 4153,
    query: async (sql, values) => calls.push({ sql, values }),
  });
  await notifications.markRead(alice, { ids: [1, "2", -1, "bad", 3.5] });
  expect(calls[0].values).toEqual([4153, alice, [1, "2"]]);
});
