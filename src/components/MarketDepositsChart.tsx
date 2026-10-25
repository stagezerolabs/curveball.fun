import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import {
  buildMarketDepositPoints,
  depositsInRange,
  type MarketDepositRange,
} from "../lib/marketDeposits";
import type { TradeActivity } from "../lib/marketChart";
import type { Token } from "../types";
import { formatUsd, useEthUsdRate } from "./UsdAmount";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

const RANGES: Array<{ value: MarketDepositRange; label: string }> = [
  { value: "day", label: "1 day" },
  { value: "week", label: "1 week" },
  { value: "month", label: "1 month" },
  { value: "all", label: "All time" },
];

function compactUsd(value: number) {
  if (Math.abs(value) < 1_000) return formatUsd(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function compactQuote(value: number, symbol: string) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1 ? 3 : 6,
  }).format(value)} ${symbol}`;
}

export function MarketDepositsChart({
  token,
  trades,
  loading,
  error,
}: {
  token: Token;
  trades: readonly TradeActivity[];
  loading: boolean;
  error: boolean;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const [currency, setCurrency] = useState<"quote" | "usd">("usd");
  const [range, setRange] = useState<MarketDepositRange>("week");
  const [themeVersion, setThemeVersion] = useState(0);
  const usdPerEth = useEthUsdRate();
  const quoteSymbol = token.quoteSymbol || "WETH";
  const points = useMemo(
    () => buildMarketDepositPoints(trades, token.initialVirtualQuote),
    [token.initialVirtualQuote, trades],
  );
  const visiblePoints = useMemo(
    () => depositsInRange(points, range),
    [points, range],
  );
  const hasDepositSeed = Boolean(
    token.initialVirtualQuote && /^\d+$/.test(token.initialVirtualQuote),
  );
  const currentQuote = points.at(-1)?.value ?? (hasDepositSeed ? 0 : null);
  const multiplier = currency === "usd" ? usdPerEth : 1;
  const currentValue =
    multiplier === null || currentQuote === null
      ? null
      : currentQuote * multiplier;
  const formatValue = (value: number) =>
    currency === "usd"
      ? compactUsd(value)
      : compactQuote(value, quoteSymbol);

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setThemeVersion((value) => value + 1),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = chartRef.current;
    if (!container) return undefined;
    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    chartInstanceRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;
    if (!visiblePoints.length || multiplier === null) {
      chart.clear();
      return;
    }
    const styles = getComputedStyle(document.documentElement);
    const text = styles.getPropertyValue("--muted").trim();
    const grid = styles.getPropertyValue("--chart-grid").trim();
    const line = styles.getPropertyValue("--lime").trim();
    chart.setOption(
      {
        animation: false,
        backgroundColor: "transparent",
        textStyle: {
          color: text,
          fontFamily: '"DM Sans", system-ui, sans-serif',
        },
        grid: { left: 2, right: 78, top: 24, bottom: 46 },
        tooltip: {
          trigger: "axis",
          backgroundColor: styles.getPropertyValue("--panel").trim(),
          borderColor: styles.getPropertyValue("--line").trim(),
          textStyle: { color: styles.getPropertyValue("--ink").trim() },
          formatter: (items: Array<{ value: [number, number] }>) => {
            const [time, value] = items[0].value;
            return `${new Date(time).toLocaleString()}<br/><strong>${formatValue(value)}</strong>`;
          },
        },
        xAxis: {
          type: "time",
          boundaryGap: false,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: text,
            hideOverlap: true,
            margin: 16,
            formatter: (value: number) =>
              new Date(value).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              }),
          },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          position: "right",
          scale: true,
          splitNumber: 4,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: text,
            margin: 14,
            formatter: (value: number) => formatValue(value),
          },
          splitLine: { lineStyle: { color: grid } },
        },
        series: [
          {
            name: "Total deposits",
            type: "line",
            showSymbol: false,
            smooth: 0.18,
            lineStyle: { color: line, width: 2 },
            itemStyle: { color: line },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: `${line}48` },
                { offset: 1, color: `${line}08` },
              ]),
            },
            data: visiblePoints.map((point) => [
              point.time * 1_000,
              point.value * multiplier,
            ]),
          },
        ],
      },
      true,
    );
  }, [currency, multiplier, quoteSymbol, themeVersion, visiblePoints]);

  const unavailable =
    !loading && (!hasDepositSeed || (error && !points.length));
  const empty = !loading && !unavailable && !points.length;

  return (
    <section
      className="market-deposits-panel"
      aria-label={`${token.symbol} total deposits chart`}
    >
      <header className="market-deposits-head">
        <div>
          <p>Total Deposits ({currency === "usd" ? "USD" : quoteSymbol})</p>
          <strong>{currentValue === null ? "—" : formatValue(currentValue)}</strong>
        </div>
        <div className="market-deposits-controls">
          <div
            className="market-deposits-currency"
            role="group"
            aria-label="Deposit chart currency"
          >
            <button
              type="button"
              className={currency === "quote" ? "active" : ""}
              aria-pressed={currency === "quote"}
              onClick={() => setCurrency("quote")}
            >
              {quoteSymbol}
            </button>
            <button
              type="button"
              className={currency === "usd" ? "active" : ""}
              aria-pressed={currency === "usd"}
              onClick={() => setCurrency("usd")}
            >
              USD
            </button>
          </div>
          <label className="market-deposits-range">
            <span className="visually-hidden">Deposit chart range</span>
            <select
              value={range}
              onChange={(event) =>
                setRange(event.target.value as MarketDepositRange)
              }
            >
              {RANGES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <div className="market-deposits-stage">
        {loading && (
          <div
            className="market-deposits-message skeleton"
            aria-label="Loading deposits"
          />
        )}
        {unavailable && (
          <p className="market-deposits-message">Deposit history unavailable</p>
        )}
        {empty && <p className="market-deposits-message">No deposits yet</p>}
        {!loading && !unavailable && currency === "usd" && usdPerEth === null && (
          <p className="market-deposits-message">USD rate unavailable</p>
        )}
        <div ref={chartRef} className="market-deposits-canvas" />
      </div>
    </section>
  );
}
