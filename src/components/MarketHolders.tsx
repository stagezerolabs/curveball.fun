import { useQuery } from "@tanstack/react-query";
import { formatEther, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { readHolderSnapshot } from "../lib/holderSnapshot";
import { parseCreatedBlock } from "../lib/marketChart";
import { formatAddress } from "../lib/format.js";
import { activeChainId, activeDeploymentBlock } from "../lib/web3";
import { fetchMarketHolders } from "../markets/api";
import { socialApiBaseUrl } from "../social/api";
import type { Navigate, Token } from "../types";
import { AppLink } from "./Navigation";
import { formatUsd, useEthUsdRate } from "./UsdAmount";

const HOLDER_LIMIT = 50;
const BURN_ADDRESS = "0x000000000000000000000000000000000000dead";

type Holder = { address: Address; balance: bigint; isFollowed: boolean };

function formatQuantity(balance: bigint) {
  const quantity = Number(formatEther(balance));
  if (quantity > 0 && quantity < 0.0001) return "<0.0001";
  return quantity.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function holderPercentage(balance: bigint, eligibleSupply: bigint) {
  if (balance <= 0n || eligibleSupply <= 0n) return 0;
  return Number((balance * 1_000_000n + eligibleSupply / 2n) / eligibleSupply) / 10_000;
}

function HolderRow({
  holder,
  rank,
  token,
  eligibleSupply,
  usdPerEth,
  navigate,
}: {
  holder: Holder;
  rank: number;
  token: Token;
  eligibleSupply: bigint;
  usdPerEth: number | null;
  navigate: Navigate;
}) {
  const percentage = holderPercentage(holder.balance, eligibleSupply);
  const isCreator = holder.address.toLowerCase() === token.creator.toLowerCase();
  const isBurn = holder.address.toLowerCase() === BURN_ADDRESS;
  const value =
    token.price == null || usdPerEth == null
      ? null
      : Number(formatEther(holder.balance)) * token.price * usdPerEth;

  return (
    <tr>
      <td className="market-holder-rank">{rank}</td>
      <td className="market-holder-address">
        <AppLink
          route="trader"
          params={{ address: holder.address }}
          navigate={navigate}
          title={holder.address}
        >
          {formatAddress(holder.address)}
        </AppLink>
      </td>
      <td className="market-holder-label">
        {isBurn
          ? "Burn address"
          : isCreator
            ? "Creator"
            : holder.isFollowed
              ? "Following"
              : "—"}
      </td>
      <td className="market-holder-quantity">
        {formatQuantity(holder.balance)} <small>{token.symbol}</small>
      </td>
      <td className="market-holder-percent">
        <strong>
          {percentage === 0 && eligibleSupply > 0n
            ? "<0.0001%"
            : `${percentage.toFixed(4)}%`}
        </strong>
        <span className="market-holder-track" aria-hidden="true">
          <span style={{ width: `${Math.min(100, percentage)}%` }} />
        </span>
      </td>
      <td className="market-holder-value">
        {value === null ? "—" : formatUsd(value)}
      </td>
    </tr>
  );
}

export function MarketHolders({
  token,
  navigate,
}: {
  token: Token;
  navigate: Navigate;
}) {
  const client = usePublicClient({ chainId: activeChainId });
  const usdPerEth = useEthUsdRate();
  const backendEnabled = Boolean(socialApiBaseUrl);
  const indexed = useQuery({
    queryKey: ["markets", "holders", token.address],
    queryFn: ({ signal }) => fetchMarketHolders(token.address, null, signal),
    enabled: backendEnabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const onchain = useQuery({
    queryKey: [
      "market-holders-rpc",
      activeChainId,
      token.address,
      token.createdBlock,
      token.factory,
      token.pool,
    ],
    enabled: !backendEnabled && Boolean(client),
    queryFn: async () => {
      if (!client) throw new Error("No chain client available.");
      const latestBlock = await client.getBlockNumber();
      const block = latestBlock > 0n ? latestBlock - 1n : latestBlock;
      const excluded = [token.factory, token.pool].filter(
        (value): value is Address => Boolean(value),
      );
      const holders = await readHolderSnapshot(
        client,
        token.address,
        parseCreatedBlock(token.createdBlock, activeDeploymentBlock),
        block,
        excluded,
      );
      return {
        atBlock: block.toString(),
        eligibleSupply: holders.reduce((sum, holder) => sum + holder.balance, 0n),
        items: holders.map((holder) => ({ ...holder, isFollowed: false })),
      };
    },
    staleTime: 120_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const active = backendEnabled ? indexed : onchain;
  const holders = (active.data?.items ?? []).slice(0, HOLDER_LIMIT);
  const eligibleSupply = active.data?.eligibleSupply ?? 0n;
  const atBlock = active.data?.atBlock;
  const unavailable = !backendEnabled && !client;

  return (
    <div className="market-holders" aria-busy={active.isPending && !unavailable}>
      <div className="market-holder-summary">
        <p>
          Top {HOLDER_LIMIT} direct holders · protocol liquidity excluded
          {atBlock ? ` · Block ${Number(atBlock).toLocaleString("en-US")}` : ""}
        </p>
        <button
          type="button"
          onClick={() => void active.refetch()}
          disabled={active.isFetching || unavailable}
        >
          {active.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {unavailable ? (
        <p className="market-activity-status" role="alert">
          Holder balances are unavailable right now.
        </p>
      ) : active.isPending ? (
        <p className="market-activity-status" role="status">
          Reading holder balances…
        </p>
      ) : active.error && !active.data ? (
        <p className="market-activity-status" role="alert">
          Holder balances are unavailable right now.
        </p>
      ) : holders.length === 0 ? (
        <p className="market-activity-status">No direct holders found yet.</p>
      ) : (
        <div
          className="market-activity-scroll"
          tabIndex={0}
          aria-label="Top holders table. Scroll horizontally to see all columns."
        >
          <table className="market-holders-table">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Address</th>
                <th scope="col">Label</th>
                <th scope="col">Quantity</th>
                <th
                  scope="col"
                  title="Share of balances held outside protocol wallets"
                >
                  Percentage
                </th>
                <th
                  scope="col"
                  title="Approximate value at the displayed token price and current ETH/USD rate"
                >
                  Est. value
                </th>
              </tr>
            </thead>
            <tbody>
              {holders.map((holder, index) => (
                <HolderRow
                  key={holder.address}
                  holder={holder}
                  rank={index + 1}
                  token={token}
                  eligibleSupply={eligibleSupply}
                  usdPerEth={usdPerEth}
                  navigate={navigate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
