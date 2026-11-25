import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingFooter } from "../components/Navigation";
import { DocsPage } from "./DocsPage";
import { documentedNetworks } from "./docsContracts";

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

test("contracts docs exclude the retired launchpad and list the oracle dependency", () => {
  const html = renderToStaticMarkup(<DocsPage navigate={navigate} slug="contracts" />);
  const documented = documentedNetworks[0];
  expect(documentedNetworks).toHaveLength(1);
  for (const contract of documented.protocol) expect(html).toContain(`${documented.explorer}/address/${contract.address}`);
  expect(html).toContain("0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62");
  if (documented.protocol.length === 0)
    expect(html).toContain("Oracle release addresses will appear after mainnet deployment.");
  expect(html).toContain("External contracts used by Curveball");
  expect(html).not.toContain("RISE Testnet");
  expect(html).not.toContain("11155931");
});
