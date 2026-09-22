import { useMemo, useState } from "react";
import { useFetch } from "../lib/useFetch";
import {
  formatAddress,
  formatCompact,
  formatEthAmount,
  formatPercent,
  formatRelativeTime,
} from "../lib/format.js";
import type { Address } from "viem";
import type { Holder, Position, Token, Trade, TradePage } from "../types";
import { RISE_TESTNET_EXPLORER_URL } from "../sdk/curveballSdk";

const EXPLORER_ADDRESS = `${RISE_TESTNET_EXPLORER_URL}/address/`;
const PAGE_SIZE = 30;
const TABS = ["trades", "holders", "about", "account"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = {
  trades: "Trades",
  holders: "Holders",
  about: "About",
  account: "Account",
};

const toEth = (wei: string) => Number(wei) / 1e18;

function Pager({
  page,
  total,
  limit,
  onPage,
}: {
  page: number;
  total: number;
  limit: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total === 0) return null;
  const first = (page - 1) * limit + 1;
  const last = Math.min(total, page * limit);
  // Show the ends plus a window around the current page; the gap becomes "…".
  const shown = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((item) => item >= 1 && item <= pages)
    .sort((a, b) => a - b);

  return (
    <div className="pager">
      <span>
        Showing {first}–{last} of {total}
      </span>
      <div className="pager-controls">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </button>
        {shown.map((item, index) => (
          <span key={item} className="pager-slot">
            {index > 0 && item - shown[index - 1] > 1 && (
              <span className="pager-gap">…</span>
            )}
            <button
              className={item === page ? "active" : ""}
              aria-current={item === page ? "page" : undefined}
              onClick={() => onPage(item)}
            >
              {item}
            </button>
          </span>
        ))}
        <button disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

function TradesTab({ token }: { token: Token }) {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useFetch<TradePage>(
    `/api/tokens/${token.address}/transactions?page=${page}&limit=${PAGE_SIZE}`,
    { rows: [], total: 0, page, limit: PAGE_SIZE },
  );
  // An API that predates pagination returns a bare array, so normalize its shape.
  const trades = useMemo(() => {
    const rows = Array.isArray(data) ? (data as Trade[]) : data?.rows;
    return {
      rows: rows ?? [],
      total: Array.isArray(data) ? (rows?.length ?? 0) : (data?.total ?? 0),
      page: Array.isArray(data) ? 1 : (data?.page ?? page),
      limit: Array.isArray(data) ? (rows?.length || PAGE_SIZE) : (data?.limit ?? PAGE_SIZE),
    };
  }, [data, page]);

  if (loading && !trades.rows.length)
    return <div className="tab-panel skeleton" />;
  if (error && !trades.rows.length)
    return <p className="tab-empty">{error}</p>;
  if (!trades.rows.length)
    return <p className="tab-empty">No trades yet. Be the first.</p>;

  return (
    <div className="tab-panel">
      <table className="trade-table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Type</th>
            <th scope="col" className="num">
              {token.quoteSymbol ?? "ETH"}
            </th>
            <th scope="col" className="num">
              {token.symbol}
            </th>
            <th scope="col" className="num">
              Price
            </th>
            <th scope="col" className="num">
              Account
            </th>
          </tr>
        </thead>
        <tbody>
          {trades.rows.map((row) => {
            const quote = toEth(row.quote);
            const amount = toEth(row.amount);
            return (
              <tr key={row.id}>
                <td>
                  {row.tradedAt ? formatRelativeTime(row.tradedAt) : "—"}
                </td>
                <td>
                  <span className={`trade-side ${row.side}`}>
                    {row.side === "buy" ? "Buy" : "Sell"}
                  </span>
                </td>
                <td className="num">{formatEthAmount(quote)}</td>
                <td className="num">{formatCompact(amount)}</td>
                <td className="num muted">
                  {amount > 0 ? formatEthAmount(quote / amount) : "—"}
                </td>
                <td className="num">
                  {row.trader ? (
                    <a
                      href={`${EXPLORER_ADDRESS}${row.trader}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {formatAddress(row.trader)}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Pager
        page={trades.page}
        total={trades.total}
        limit={trades.limit}
        onPage={setPage}
      />
    </div>
  );
}

function HoldersTab({ token }: { token: Token }) {
  const { data, loading, error } = useFetch<Holder[]>(
    `/api/tokens/${token.address}/holders`,
    [],
  );
  const holders = data;
  const supply = useMemo(
    () => holders.reduce((total, holder) => total + holder.balance, 0),
    [holders],
  );

  if (loading && !holders.length) return <div className="tab-panel skeleton" />;
  if (error && !holders.length) return <p className="tab-empty">{error}</p>;
  if (!holders.length) return <p className="tab-empty">No holders yet.</p>;

  return (
    <div className="tab-panel">
      <table className="trade-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Account</th>
            <th scope="col" className="num">
              Balance
            </th>
            <th scope="col" className="num">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {holders.map((holder, index) => (
            <tr key={holder.address}>
              <td className="muted">{index + 1}</td>
              <td>
                <a
                  href={`${EXPLORER_ADDRESS}${holder.address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {formatAddress(holder.address)}
                </a>
                {holder.address.toLowerCase() === token.creator.toLowerCase() && (
                  <span className="holder-tag">Creator</span>
                )}
              </td>
              <td className="num">{formatCompact(holder.balance)}</td>
              <td className="num">
                {supply > 0 ? formatPercent((holder.balance / supply) * 100) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tab-note">
        Derived from trades on the curve. Tokens moved wallet-to-wallet are not
        reflected here.
      </p>
    </div>
  );
}

function AboutTab({ token }: { token: Token }) {
  const links = [
    token.website && { label: "Website", href: token.website },
    token.xHandle && {
      label: "X",
      href: `https://x.com/${token.xHandle.replace(/^@/, "")}`,
    },
    token.telegram && {
      label: "Telegram",
      href: `https://t.me/${token.telegram.replace(/^@/, "")}`,
    },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <div className="tab-panel about-panel">
      <p className="about-description">
        {token.description || "The creator has not added a description yet."}
      </p>
      <dl className="about-facts">
        <div>
          <dt>Contract</dt>
          <dd>
            <a
              href={`${EXPLORER_ADDRESS}${token.address}`}
              target="_blank"
              rel="noreferrer"
            >
              {formatAddress(token.address)}
            </a>
          </dd>
        </div>
        <div>
          <dt>Creator</dt>
          <dd>
            <a
              href={`${EXPLORER_ADDRESS}${token.creator}`}
              target="_blank"
              rel="noreferrer"
            >
              {formatAddress(token.creator)}
            </a>
          </dd>
        </div>
        {token.pool && (
          <div>
            <dt>Pool</dt>
            <dd>
              <a
                href={`${EXPLORER_ADDRESS}${token.pool}`}
                target="_blank"
                rel="noreferrer"
              >
                {formatAddress(token.pool)}
              </a>
            </dd>
          </div>
        )}
        <div>
          <dt>Launched</dt>
          <dd>{formatRelativeTime(token.createdAt)}</dd>
        </div>
        <div>
          <dt>Holders</dt>
          <dd>{token.holders ?? "—"}</dd>
        </div>
        <div>
          <dt>24h volume</dt>
          <dd>{formatCompact(token.volume24h)} ETH</dd>
        </div>
      </dl>
      {links.length > 0 && (
        <p className="about-links">
          {links.map((link) => (
            <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}

function AccountTab({
  token,
  address,
  connectWallet,
}: {
  token: Token;
  address?: Address;
  connectWallet: () => void;
}) {
  const { data, loading } = useFetch<Position | null>(
    address ? `/api/tokens/${token.address}/position/${address}` : null,
    null,
  );
  const position = address ? data : null;

  if (!address)
    return (
      <div className="tab-panel tab-connect">
        <p>Connect your wallet to see your position in ${token.symbol}.</p>
        <button className="primary-button" onClick={connectWallet}>
          Connect wallet
        </button>
      </div>
    );

  if (loading && !position) return <div className="tab-panel skeleton" />;
  if (!position || position.trades === 0)
    return <p className="tab-empty">You have not traded ${token.symbol} yet.</p>;

  const value = token.price ? position.balance * token.price : null;
  const costBasis =
    position.avgCost === null ? null : position.balance * position.avgCost;
  const unrealised =
    value !== null && costBasis !== null ? value - costBasis : null;

  return (
    <div className="tab-panel">
      <dl className="account-figures">
        <div>
          <dt>Balance</dt>
          <dd>
            {formatCompact(position.balance)} {token.symbol}
          </dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{value === null ? "—" : `${formatEthAmount(value)} ETH`}</dd>
        </div>
        <div>
          <dt>Average cost</dt>
          <dd>
            {position.avgCost === null
              ? "—"
              : `${formatEthAmount(position.avgCost)} ETH`}
          </dd>
        </div>
        <div>
          <dt>Unrealised</dt>
          <dd
            className={
              unrealised === null ? "" : unrealised >= 0 ? "up" : "down"
            }
          >
            {unrealised === null
              ? "—"
              : `${unrealised >= 0 ? "+" : "−"}${formatEthAmount(Math.abs(unrealised))} ETH`}
          </dd>
        </div>
        <div>
          <dt>Total spent</dt>
          <dd>{formatEthAmount(position.invested)} ETH</dd>
        </div>
        <div>
          <dt>Total received</dt>
          <dd>{formatEthAmount(position.proceeds)} ETH</dd>
        </div>
      </dl>
      <p className="tab-note">
        Your {position.trades} trade{position.trades === 1 ? "" : "s"} on this
        curve. Unrealised value uses the current spot price.
      </p>
    </div>
  );
}

export function MarketTabs({
  token,
  address,
  connectWallet,
}: {
  token: Token;
  address?: Address;
  connectWallet: () => void;
}) {
  const [tab, setTab] = useState<Tab>("trades");

  return (
    <section className="detail-tabs">
      <div className="tab-strip" role="tablist" aria-label="Market details">
        {TABS.map((item) => (
          <button
            key={item}
            role="tab"
            id={`market-tab-${item}`}
            aria-selected={tab === item}
            aria-controls="market-tabpanel"
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {LABELS[item]}
          </button>
        ))}
      </div>
      <div
        id="market-tabpanel"
        role="tabpanel"
        aria-labelledby={`market-tab-${tab}`}
      >
        {tab === "trades" && <TradesTab token={token} />}
        {tab === "holders" && <HoldersTab token={token} />}
        {tab === "about" && <AboutTab token={token} />}
        {tab === "account" && (
          <AccountTab
            token={token}
            address={address}
            connectWallet={connectWallet}
          />
        )}
      </div>
    </section>
  );
}
