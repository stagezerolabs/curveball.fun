import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatEther, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { readHolderSnapshot } from "../lib/holderSnapshot";
import { parseCreatedBlock } from "../lib/marketChart";
import {
  activeChainId,
  activeDeploymentBlock,
  activeExplorerUrl,
} from "../lib/web3";
import { curveLaunchpadAbi } from "../sdk/contracts";
import { fetchMarketHolders } from "../markets/api";
import { TraderName } from "../social/TraderIdentity";
import { socialApiBaseUrl } from "../social/api";
import type { Navigate, Token } from "../types";

function amount(value: bigint) {
  return Number(formatEther(value)).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

type HolderRow = { address: Address; balance: bigint; isFollowed: boolean };

/**
 * Top holders for a launch. The indexed read model is preferred because it knows which wallets the
 * viewer follows; without a backend the list falls back to a full on-chain transfer scan.
 */
export function CreatorTokenInsights({
  token,
  navigate,
}: {
  token: Token;
  navigate: Navigate;
}) {
  const client = usePublicClient({ chainId: activeChainId });
  const backendEnabled = Boolean(socialApiBaseUrl);
  const [showAllHolders, setShowAllHolders] = useState(false);
  const onchainHolders = useQuery({
    queryKey: [
      "creator-holders",
      activeChainId,
      token.address,
      token.createdBlock,
      token.pool,
      token.factory,
    ],
    enabled: !backendEnabled && Boolean(client),
    queryFn: async (): Promise<{
      holders: HolderRow[];
      block: bigint | null;
    }> => {
      if (!client) throw new Error("No chain client available.");
      const latestBlock = await client.getBlockNumber();
      const block = latestBlock > 0n ? latestBlock - 1n : latestBlock;
      // The launchpad holds unsold curve tokens and the holder reserve holds the reserve; neither is a holder.
      const reserve = token.factory
        ? await client.readContract({
            address: token.factory,
            abi: curveLaunchpadAbi,
            functionName: "reserve",
          })
        : null;
      const excluded = [token.factory, token.pool, reserve].filter(
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
        holders: holders.map((holder) => ({ ...holder, isFollowed: false })),
        block,
      };
    },
    staleTime: 120_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const indexedHolders = useQuery({
    queryKey: ["markets", "holders", token.address],
    queryFn: ({ signal }) => fetchMarketHolders(token.address, null, signal),
    enabled: backendEnabled,
    staleTime: 30_000,
    retry: 1,
  });
  const active = backendEnabled ? indexedHolders : onchainHolders;
  const holders =
    (backendEnabled
      ? indexedHolders.data?.items
      : onchainHolders.data?.holders) ?? [];
  const snapshotBlock = backendEnabled
    ? (indexedHolders.data?.atBlock ?? null)
    : (onchainHolders.data?.block ?? null);
  const followedCount = holders.filter((holder) => holder.isFollowed).length;
  const holdersLoading = active.isPending;
  const holdersError = !active.data && active.error ? active.error.message : "";
  const directBalance = holders.reduce(
    (sum, holder) => sum + holder.balance,
    0n,
  );
  const visibleHolders = showAllHolders ? holders : holders.slice(0, 10);
  return (
    <div className="creator-insights">
      <section
        id="profile-holders"
        className="creator-data-panel"
        aria-labelledby="creator-holders-title"
        aria-busy={holdersLoading}
      >
        <div className="creator-data-heading">
          <div>
            <h3 id="creator-holders-title">Top holders</h3>
            <p>
              {holdersLoading
                ? "Loading wallet balances…"
                : followedCount
                  ? `${followedCount} ${followedCount === 1 ? "wallet" : "wallets"} you follow hold this`
                  : snapshotBlock === null
                    ? "Wallet balances across the token's transfers"
                    : `Wallet balances at block ${snapshotBlock}`}
            </p>
          </div>
          <span className="creator-data-actions">
            <strong>
              {holdersLoading ? "…" : holders.length.toLocaleString("en-US")}{" "}
              {holders.length === 1 ? "holder" : "holders"}
            </strong>
            <button
              type="button"
              className="market-refresh"
              onClick={() => void active.refetch()}
              disabled={active.isFetching}
              aria-label={
                active.isFetching ? "Refreshing holders" : "Refresh holders"
              }
              aria-busy={active.isFetching}
              title="Refresh holders"
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M16.8 8A7 7 0 1 0 17 11" />
                <path d="M17 3.5V8h-4.5" />
              </svg>
            </button>
          </span>
        </div>
        {holdersLoading ? (
          <p className="creator-data-status" role="status">
            Reading holder balances…
          </p>
        ) : holdersError ? (
          <p className="creator-data-status" role="alert">
            Holder balances are unavailable. {holdersError}
          </p>
        ) : holders.length === 0 ? (
          <p className="creator-data-status">No direct holders found yet.</p>
        ) : (
          <>
            <div
              className="creator-table-wrap"
              tabIndex={0}
              aria-label="Top holders table, scroll horizontally for all columns"
            >
              <table className="creator-table">
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Wallet</th>
                    <th scope="col">Balance</th>
                    <th scope="col">Share of direct holdings</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleHolders.map((holder, index) => (
                    <tr key={holder.address}>
                      <td>{String(index + 1).padStart(2, "0")}</td>
                      <td className="creator-holder-wallet">
                        {backendEnabled ? (
                          <>
                            <TraderName
                              address={holder.address}
                              navigate={navigate}
                            />
                            {holder.isFollowed ? (
                              <span className="market-activity-following">
                                Following
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <a
                            href={`${activeExplorerUrl}/address/${holder.address}`}
                            target="_blank"
                            rel="noreferrer"
                            title={holder.address}
                          >
                            {shortAddress(holder.address)} ↗
                          </a>
                        )}
                      </td>
                      <td>
                        {amount(holder.balance)} {token.symbol}
                      </td>
                      <td>
                        {directBalance > 0n
                          ? (
                              Number(
                                (holder.balance * 10_000n) / directBalance,
                              ) / 100
                            ).toFixed(2)
                          : "0.00"}
                        %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {holders.length > 10 && (
              <button
                type="button"
                className="market-refresh creator-show-more"
                onClick={() => setShowAllHolders((value) => !value)}
              >
                {showAllHolders
                  ? "Show top 10"
                  : `Show all ${holders.length} holders`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
