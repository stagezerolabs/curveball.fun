import { useMemo, useState } from "react";
import { useFetch } from "../lib/useFetch";
import {
  formatAddress,
  formatCompact,
  formatEthAmount,
  formatRelativeTime,
} from "../lib/format.js";
import type { Token, Trade, TradePage } from "../types";
import { activeExplorerUrl } from "../lib/web3";

const EXPLORER_ADDRESS = `${activeExplorerUrl}/address/`;
const PAGE_SIZE = 30;
const TABS = ["trades", "about"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = {
  trades: "Trades",
  about: "About",
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

export function MarketTabs({ token }: { token: Token }) {
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
        {tab === "about" && <AboutTab token={token} />}
      </div>
    </section>
  );
}
