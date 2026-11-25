import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketTape } from "./MarketTape";

test("CURVE tape shows outstanding curve sales rather than gross buys", () => {
  const html = renderToStaticMarkup(
    <MarketTape
      curveStats={{ volume24h: "$570", netSold: "194.4M", burnedTotal: "0" }}
    />,
  );
  expect(html).toContain("Net sold");
  expect(html).toContain("194.4M");
  expect(html).toContain("current");
  expect(html).not.toContain("Bought");
});
