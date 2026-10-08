import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
} from "lightweight-charts";
import { usePublicClient } from "wagmi";
import { launchpadAbi } from "../sdk/contracts";
import { v2CurveAbi } from "../sdk/v2Contracts";
import {
  activeChainId,
  activeContractVersion,
  activeDeploymentBlock,
  launchpadAddress,
} from "../lib/web3";
import {
  buildBlockRanges,
  buildCandles,
  parseCreatedBlock,
  tradeLogToPoint,
  type TradePoint,
  withRetry,
} from "../lib/marketChart";
import type { Token } from "../types";

const MAX_EVENT_QUERY_BLOCKS = 5_000n;
const EVENT_QUERY_CONCURRENCY = 6;

const tradePointCache = new Map<string, {
  lastBlock: bigint;
  points: TradePoint[];
}>();

const INTERVALS = [
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3_600 },
  { label: "4h", seconds: 14_400 },
  { label: "1d", seconds: 86_400 },
] as const;

type TradeLog = {
  args?: {
    quoteAmount?: bigint;
    grossCurveQuote?: bigint;
    vQAfter?: bigint;
    vTAfter?: bigint;
  };
  blockNumber?: bigint | null;
};

type ChartClient = {
  getBlockNumber(): Promise<bigint>;
  getContractEvents(parameters: object): Promise<readonly TradeLog[]>;
  getBlock(parameters: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
};

async function queryTradeLogs(client: ChartClient, token: Token) {
  const address = activeContractVersion === "v2" ? token.curve : launchpadAddress;
  if (!address) return { latestBlock: 0n, logs: [] as TradeLog[] };

  const cacheKey = `${activeChainId}:${token.address.toLowerCase()}`;
  const cached = tradePointCache.get(cacheKey);
  const latestBlock = await withRetry(() => client.getBlockNumber());
  const createdBlock = parseCreatedBlock(token.createdBlock, activeDeploymentBlock);
  const fromBlock = cached && cached.lastBlock >= createdBlock
    ? cached.lastBlock + 1n
    : createdBlock;
  const ranges = buildBlockRanges(fromBlock, latestBlock, MAX_EVENT_QUERY_BLOCKS);

  const eventQuery = {
    address,
    abi: activeContractVersion === "v2" ? v2CurveAbi : launchpadAbi,
    eventName: "Trade",
    args: { token: token.address },
    strict: true,
  };
  const logs: TradeLog[] = [];
  let nextRange = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(EVENT_QUERY_CONCURRENCY, ranges.length) },
      async () => {
        while (nextRange < ranges.length) {
          const range = ranges[nextRange++];
          logs.push(...(await withRetry(() =>
            client.getContractEvents({ ...eventQuery, ...range })
          )));
        }
      },
    ),
  );
  return { latestBlock, logs };
}

async function loadTradePoints(client: ChartClient, token: Token) {
  const cacheKey = `${activeChainId}:${token.address.toLowerCase()}`;
  const cached = tradePointCache.get(cacheKey);
  let result: Awaited<ReturnType<typeof queryTradeLogs>>;
  try {
    result = await queryTradeLogs(client, token);
  } catch (error) {
    if (cached) return cached.points;
    throw error;
  }
  const { latestBlock, logs } = result;
  const blockNumbers = [
    ...new Set(
      logs
        .map((log) => log.blockNumber)
        .filter((block): block is bigint => block !== null && block !== undefined),
    ),
  ];
  const timestamps = new Map<bigint, number>();
  let nextBlock = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(EVENT_QUERY_CONCURRENCY, blockNumbers.length) },
      async () => {
        while (nextBlock < blockNumbers.length) {
          const blockNumber = blockNumbers[nextBlock++];
          const block = await withRetry(() => client.getBlock({ blockNumber }));
          timestamps.set(blockNumber, Number(block.timestamp));
        }
      },
    ),
  );

  const newPoints = logs.flatMap((log): TradePoint[] => {
    const blockNumber = log.blockNumber;
    if (!blockNumber) return [];
    const point = tradeLogToPoint(log.args, timestamps.get(blockNumber));
    return point ? [point] : [];
  });
  const points = cached ? [...cached.points, ...newPoints] : newPoints;
  tradePointCache.set(cacheKey, { lastBlock: latestBlock, points });
  return points;
}

function formatChartValue(value: number) {
  if (!Number.isFinite(value)) return "—";
  return value >= 1
    ? value.toLocaleString("en-US", { maximumFractionDigits: 4 })
    : value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function MarketChart({
  token,
  refreshKey,
}: {
  token: Token;
  refreshKey?: number;
}) {
  const publicClient = usePublicClient({ chainId: activeChainId });
  const chartRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<TradePoint[]>([]);
  const [interval, setInterval] = useState(60);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [themeVersion, setThemeVersion] = useState(0);
  const [hover, setHover] = useState<{ close: number; volume: number } | null>(null);
  const candles = useMemo(() => buildCandles(points, interval), [points, interval]);

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!publicClient || refreshKey === 0) return undefined;
    setLoading(true);
    setError("");
    setPoints([]);
    setHover(null);
    void loadTradePoints(publicClient as unknown as ChartClient, token)
      .then((nextPoints) => {
        if (!cancelled) setPoints(nextPoints);
      })
      .catch(() => {
        if (!cancelled) setError("Chart unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicClient, refreshKey, token.address, token.curve]);

  useEffect(() => {
    const container = chartRef.current;
    if (!container || !candles.length) return undefined;
    const styles = getComputedStyle(document.documentElement);
    const textColor = styles.getPropertyValue("--muted").trim();
    const gridColor = styles.getPropertyValue("--chart-grid").trim();
    const lime = styles.getPropertyValue("--lime").trim();
    const orange = styles.getPropertyValue("--orange").trim();
    const chart = createChart(container, {
      autoSize: true,
      height: 430,
      layout: {
        attributionLogo: true,
        background: { type: ColorType.Solid, color: "transparent" },
        textColor,
        fontFamily: '"DM Sans", system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: textColor, style: LineStyle.Dashed, labelBackgroundColor: textColor },
        horzLine: { color: textColor, style: LineStyle.Dashed, labelBackgroundColor: textColor },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.24 },
      },
      timeScale: {
        borderVisible: false,
        rightOffset: 6,
        timeVisible: true,
        secondsVisible: false,
      },
      localization: { priceFormatter: formatChartValue },
    });
    const smallestPrice = Math.min(
      ...candles.flatMap((candle) => [candle.open, candle.high, candle.low, candle.close]),
    );
    const precision = smallestPrice >= 1
      ? 4
      : Math.min(12, Math.max(4, -Math.floor(Math.log10(smallestPrice)) + 2));
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: lime,
      downColor: orange,
      wickUpColor: lime,
      wickDownColor: orange,
      borderUpColor: lime,
      borderDownColor: orange,
      priceFormat: {
        type: "price",
        precision,
        minMove: 10 ** -precision,
      },
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    });
    const candleData: CandlestickData<UTCTimestamp>[] = candles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    const volumeData: HistogramData<UTCTimestamp>[] = candles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      value: candle.volume,
      color: candle.close >= candle.open ? `${lime}55` : `${orange}55`,
    }));
    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
    chart.timeScale().fitContent();
    setHover({
      close: candles[candles.length - 1].close,
      volume: candles[candles.length - 1].volume,
    });
    chart.subscribeCrosshairMove((param) => {
      const candle = param.seriesData.get(candleSeries);
      const volume = param.seriesData.get(volumeSeries);
      if (candle && "close" in candle) {
        setHover({
          close: candle.close,
          volume: volume && "value" in volume ? volume.value : 0,
        });
      }
    });
    return () => chart.remove();
  }, [candles, themeVersion]);

  return (
    <section className="market-chart-panel" aria-label={`${token.symbol} price chart`}>
      <header className="market-chart-head">
        <div>
          <span>{token.graduated ? "Bonding curve history" : "Curve price"} · {token.quoteSymbol ?? "WETH"}</span>
          <strong>{hover ? formatChartValue(hover.close) : "—"}</strong>
          {hover && <small>Volume {formatChartValue(hover.volume)}</small>}
        </div>
        <div className="chart-intervals" role="group" aria-label="Chart interval">
          {INTERVALS.map((item) => (
            <button
              key={item.label}
              type="button"
              className={interval === item.seconds ? "active" : ""}
              aria-pressed={interval === item.seconds}
              onClick={() => setInterval(item.seconds)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>
      <div className="market-chart-stage">
        {loading && <div className="market-chart-message skeleton" aria-label="Loading chart" />}
        {!loading && error && <p className="market-chart-message">{error}</p>}
        {!loading && !error && !candles.length && (
          <p className="market-chart-message">No trades yet</p>
        )}
        <div ref={chartRef} className="market-chart-canvas" />
      </div>
    </section>
  );
}
