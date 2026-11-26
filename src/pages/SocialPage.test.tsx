import { expect, test } from "bun:test";
import { PULSE_TABS } from "./SocialPage";

test("Pulse shows Now and Leaderboard, without a Following tab", () => {
  expect(PULSE_TABS.map((tab) => tab.value)).toEqual(["now", "leaderboard"]);
});
