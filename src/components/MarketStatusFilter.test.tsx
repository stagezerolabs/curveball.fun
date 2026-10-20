import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketStatusFilter } from "./MarketStatusFilter";
import { MarketViewSwitch } from "./MarketViewSwitch";

test("market status filter exposes one keyboard-selected option", () => {
  const html = renderToStaticMarkup(<MarketStatusFilter value="curve" onChange={() => undefined} />);

  expect(html).toContain('role="radiogroup"');
  expect(html).toContain('aria-label="Market status"');
  expect(html.match(/role="radio"/g)?.length).toBe(3);
  expect(html).toContain('class="active" role="radio" aria-checked="true" tabindex="0">On the curve</button>');
  expect(html.match(/aria-checked="false" tabindex="-1"/g)?.length).toBe(2);
});

test("market view switch uses the same accessible segmented interaction", () => {
  const html = renderToStaticMarkup(<MarketViewSwitch value="cards" onChange={() => undefined} />);

  expect(html).toContain('class="animated-segmented market-view-switch"');
  expect(html).toContain('aria-label="Market view"');
  expect(html.match(/role="radio"/g)?.length).toBe(2);
  expect(html).toContain('aria-checked="true" tabindex="0"');
  expect(html).toContain("Cards");
  expect(html).toContain("Rows");
});
