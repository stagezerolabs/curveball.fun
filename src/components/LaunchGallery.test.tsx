import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { Token } from "../types";
import { LaunchGallery, LaunchSummary } from "./LaunchGallery";

function token(overrides: Partial<Token> = {}): Token {
  return {
    address: "0x1111111111111111111111111111111111111111",
    creator: "0x2222222222222222222222222222222222222222",
    name: "Alpha",
    symbol: "ALPHA",
    quoteSymbol: "WETH",
    createdAt: "2026-01-01T00:00:00.000Z",
    graduated: false,
    ...overrides,
  };
}

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
  );
}

const beta = token({
  address: "0x3333333333333333333333333333333333333333",
  name: "Beta",
  symbol: "BETA",
});

test("every launch is a named tile with no image; the selected one is pressed", () => {
  const html = render(
    <LaunchGallery
      tokens={[token(), beta]}
      selected={beta.address}
      onSelect={() => undefined}
    />,
  );
  expect(html.match(/class="launch-tile( selected)?"/g)?.length).toBe(2);
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain("Alpha");
  expect(html).toContain("Beta");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("token-avatar");
});

test("the summary shows graduation progress like the market panel", () => {
  const html = render(
    <LaunchSummary
      token={token({
        progress: 24.4,
        curveLiquidityWeth: 0.2425,
        graduationTargetWeth: "4",
      })}
    />,
  );
  expect(html).toContain("Alpha");
  expect(html).toContain("$ALPHA");
  expect(html).toContain("Curve tokens sold");
  expect(html).toContain("24.4%");
  expect(html).toContain("Current cap");
  expect(html).toContain("Net WETH raised");
  expect(html).toContain("4 WETH");
  expect(html).toContain("WETH target filled");
  expect(html).toContain("6.1%");
  expect(html).toContain("Market cap at graduation");
  expect(html).not.toContain("View market");
});

test("a graduated launch shows only its market cap", () => {
  const html = render(<LaunchSummary token={token({ graduated: true })} />);
  expect(html).toContain("Current cap");
  expect(html).not.toContain("Curve tokens sold");
  expect(html).not.toContain("Market cap at graduation");
});
