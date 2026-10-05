import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketTabs } from "./MarketTabs";
import type { Token } from "../types";

test("market details do not offer unindexed wallet holdings", () => {
  const token = {
    address: "0x1111111111111111111111111111111111111111",
    creator: "0x2222222222222222222222222222222222222222",
    name: "Token",
    symbol: "TKN",
    graduated: false,
    createdAt: new Date().toISOString(),
  } as Token;
  const html = renderToStaticMarkup(<MarketTabs token={token} />);
  expect(html).not.toContain("Holders");
  expect(html).not.toContain("Account");
});
