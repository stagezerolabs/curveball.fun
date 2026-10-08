import { describe, expect, test } from "bun:test";
import { formatLaunchElapsed, launchMilestone } from "./launchProgress";

describe("launch progress", () => {
  test("shows elapsed time across minute and hour boundaries", () => {
    expect(formatLaunchElapsed(0)).toBe("0:00");
    expect(formatLaunchElapsed(75)).toBe("1:15");
    expect(formatLaunchElapsed(3661)).toBe("1:01:01");
  });

  test("keeps wallet setup in the wallet milestone", () => {
    expect(launchMilestone("preparing")).toBe(0);
    expect(launchMilestone("wrapConfirming")).toBe(1);
    expect(launchMilestone("approveWallet")).toBe(1);
    expect(launchMilestone("confirming")).toBe(2);
    expect(launchMilestone("success")).toBe(4);
  });
});
