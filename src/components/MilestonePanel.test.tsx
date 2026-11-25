import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "../lib/web3";
import type { Token } from "../types";
import { MilestonePanel } from "./MilestonePanel";

test("graduation panel distinguishes curve tokens sold from WETH raised", () => {
  const token: Token = {
    address: "0x65014eDD6ea4A53152780742360Fb4685Abab689",
    creator: "0x1111111111111111111111111111111111111111",
    name: "Curveball",
    symbol: "CURVE",
    createdAt: "2026-11-25T00:00:00.000Z",
    graduated: false,
    progress: 24.4,
    curveLiquidityWeth: 0.242008704592934018,
    graduationTargetWeth: "4",
  };
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
        <MilestonePanel token={token} />
      </WagmiProvider>
    </QueryClientProvider>,
  );
  expect(html).toContain("Curve tokens sold");
  expect(html).toContain("24.4%");
  expect(html).toContain("WETH raised");
  expect(html).toContain("6.1%");
  expect(html).toContain("4 WETH");
});
