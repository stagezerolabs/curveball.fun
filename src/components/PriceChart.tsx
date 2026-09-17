import { useMemo, useState } from "react";
import { useFetch } from "../lib/useFetch";
import { mockCandles } from "./../lib/mockData";
import { formatCompact, formatEthAmount } from "../lib/format.js";
import type { Candle, CandleRange, Token } from "../types";

const RANGES: CandleRange[] = ["5min", "1h", "6h", "1D", "all"];
const RANGE_LABEL: Record<CandleRange, string> = {
  "5min": "5min",
  "1h": "1h",
  "6h": "6h",
  "1D": "1D",
  all: "All",
};

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 300;
const PAD_TOP = 14;
const PAD_BOTTOM = 14;

function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PriceChart({ token }: { token: Token }) {
  const [range, setRange] = useState<CandleRange>("1D");
  const [metric, setMetric] = useState<"price" | "cap">("cap");

  const { data, loading, error } = useFetch<Candle[]>(
    `/api/tokens/${token.address}/candles?range=${range}`,
    [],
  );
  // Dev-only: an empty API falls back to sample data. Real rows always win.
  const candles = useMemo(
    () => (data.length ? data : mockCandles(token.address, range)),
    [data, token.address, range],
  );

  // Market cap is price × total supply, so the curve shape is identical — only
  // the axis labels change. Deriving it avoids a second series over the wire.
  const supply = useMemo(() => {
    if (!token.price || !token.marketCap) return null;
    return token.marketCap / token.price;
  }, [token.price, token.marketCap]);

  const scaled = useMemo(
    () =>
      candles.map((candle) => ({
        ...candle,
        value:
          metric === "cap" && supply ? candle.price * supply : candle.price,
      })),
    [candles, metric, supply],
  );

  const geometry = useMemo(() => {
    if (scaled.length < 2) return null;
    const values = scaled.map((point) => point.value);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low || high || 1;
    const usable = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
    const path = scaled
      .map((point, index) => {
        const x = (index / (scaled.length - 1)) * VIEW_WIDTH;
        const y = PAD_TOP + usable - ((point.value - low) / span) * usable;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    return { path, low, high, last: values[values.length - 1] };
  }, [scaled]);

  const unit = metric === "cap" ? " ETH" : " ETH";
  const label = (value: number) =>
    metric === "cap"
      ? `${formatCompact(value)}${unit}`
      : `${formatEthAmount(value)}${unit}`;

  return (
    <section className="chart-card" aria-label="Price history">
      <header className="chart-head">
        <div className="chart-metric" role="group" aria-label="Chart metric">
          <button
            className={metric === "price" ? "active" : ""}
            aria-pressed={metric === "price"}
            onClick={() => setMetric("price")}
          >
            Price
          </button>
          <button
            className={metric === "cap" ? "active" : ""}
            aria-pressed={metric === "cap"}
            onClick={() => setMetric("cap")}
            disabled={!supply}
          >
            Market cap
          </button>
        </div>
        <div className="chart-ranges" role="group" aria-label="Time range">
          {RANGES.map((item) => (
            <button
              key={item}
              className={range === item ? "active" : ""}
              aria-pressed={range === item}
              onClick={() => setRange(item)}
            >
              {RANGE_LABEL[item]}
            </button>
          ))}
        </div>
      </header>

      <div className="chart-body">
        {loading && !candles.length ? (
          <div className="chart-empty skeleton" />
        ) : error && !candles.length ? (
          <p className="chart-empty">{error}</p>
        ) : !geometry ? (
          <p className="chart-empty">Not enough trades in this range yet.</p>
        ) : (
          <>
            <svg
              className="chart-svg"
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`${metric === "cap" ? "Market cap" : "Price"} over ${RANGE_LABEL[range]}, ${label(geometry.low)} to ${label(geometry.high)}`}
            >
              <polygon
                className="chart-area"
                points={`0,${VIEW_HEIGHT} ${geometry.path} ${VIEW_WIDTH},${VIEW_HEIGHT}`}
              />
              <polyline className="chart-line" points={geometry.path} />
            </svg>
            <span className="chart-high">{label(geometry.high)}</span>
            <span className="chart-last">{label(geometry.last)}</span>
          </>
        )}
      </div>

      {candles.length > 1 && (
        <footer className="chart-axis" aria-hidden="true">
          <span>{clockTime(candles[0].t)}</span>
          <span>{clockTime(candles[Math.floor(candles.length / 2)].t)}</span>
          <span>{clockTime(candles[candles.length - 1].t)}</span>
        </footer>
      )}
    </section>
  );
}
