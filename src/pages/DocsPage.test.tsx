import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingFooter } from "../components/Navigation";
import { DocsPage } from "./DocsPage";
import { documentedNetworks } from "./docsContracts";
import mainnet from "../../deployments/4153/curveball.json";
import mainnetAdapter from "../../deployments/4153/icarus-swap-adapter.json";
import testnet from "../../deployments/11155931/curveball.json";
import testnetAdapter from "../../deployments/11155931/icarus-swap-adapter.json";
import testnetSmoke from "../../deployments/11155931/smoke.json";

const navigate = () => undefined;

test("the footer opens the documentation home", () => {
  const html = renderToStaticMarkup(
    <LandingFooter navigate={navigate} theme="dark" />,
  );
  expect(html).toContain('href="/docs"');
  expect(html).not.toContain('href="#landing-faq-title"');
});

test("docs topics have direct links and the selected chapter has navigation", () => {
  const home = renderToStaticMarkup(<DocsPage navigate={navigate} />);
  const trading = renderToStaticMarkup(
    <DocsPage navigate={navigate} slug="trading" />,
  );

  expect(home).toContain('href="/docs/trading"');
  expect(home).toContain("Explore the documentation.");
  expect(trading).toContain("Trade through the curve and beyond.");
  expect(trading).toContain('aria-current="page"');
  expect(trading).toContain('href="/docs/graduation"');
  expect(home).toContain('href="/docs/contracts"');
});

test("contracts docs list every recorded Curveball deployment on both networks", () => {
  const html = renderToStaticMarkup(<DocsPage navigate={navigate} slug="contracts" />);
  for (const [index, record, adapter] of [
    [0, mainnet, mainnetAdapter],
    [1, testnet, testnetAdapter],
  ] as const) {
    const documented = documentedNetworks[index];
    const expected = new Set([
      record.launchpad,
      ...Object.values(record.singletons),
      adapter.adapter,
      ...(record.chainId === 4153 ? [record.owner] : []),
    ]);
    expect(new Set(documented.protocol.map(({ address }) => address))).toEqual(expected);
    for (const address of expected) expect(html).toContain(`${documented.explorer}/address/${address}`);
  }
  expect(html).toContain("External contracts used by Curveball");
  expect(html).toContain("Market contracts have their own addresses.");
  expect(html).toContain(testnetSmoke.token);
  expect(html).toContain(testnetSmoke.pool);
});
