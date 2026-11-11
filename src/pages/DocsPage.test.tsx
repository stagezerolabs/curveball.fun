import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingFooter } from "../components/Navigation";
import { DocsPage } from "./DocsPage";
import { documentedNetworks } from "./docsContracts";
import mainnet from "../../deployments/4153/curveball.json";
import mainnetAdapter from "../../deployments/4153/icarus-swap-adapter.json";

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

  expect(home).not.toContain('href="/docs/launching"');
  expect(home).toContain('href="/docs/trading"');
  expect(home).toContain("Explore the documentation.");
  expect(trading).toContain("Check the venue.");
  expect(trading).toContain('aria-current="page"');
  expect(trading).toContain('href="/docs/graduation"');
  expect(home).toContain('href="/docs/contracts"');
});

test("contracts docs list only the recorded RISE Mainnet deployment", () => {
  const html = renderToStaticMarkup(<DocsPage navigate={navigate} slug="contracts" />);
  const documented = documentedNetworks[0];
  const expected = new Set([
    mainnet.launchpad,
    ...Object.values(mainnet.singletons),
    mainnetAdapter.adapter,
    mainnet.owner,
  ]);
  expect(documentedNetworks).toHaveLength(1);
  expect(new Set(documented.protocol.map(({ address }) => address))).toEqual(expected);
  for (const address of expected) expect(html).toContain(`${documented.explorer}/address/${address}`);
  expect(html).toContain("External contracts used by Curveball");
  expect(html).not.toContain("RISE Testnet");
  expect(html).not.toContain("11155931");
});
