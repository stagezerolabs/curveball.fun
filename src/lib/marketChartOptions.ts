import type { MarketCandle } from "./marketChart";

type ChartColors = {
  text: string;
  grid: string;
  lime: string;
  orange: string;
};

function formatMarketCap(value: number, usdPerEth?: number | null) {
  if (!Number.isFinite(value)) return "—";
  if (usdPerEth && Number.isFinite(usdPerEth)) {
    const usd = value * usdPerEth;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: Math.abs(usd) >= 1_000 ? "compact" : "standard",
      maximumFractionDigits: Math.abs(usd) >= 1 ? 2 : 4,
    }).format(usd);
  }
  return `${value.toLocaleString("en-US", {
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 4,
  })} WETH`;
}

export function buildMarketChartOptions(
  candles: readonly MarketCandle[],
  colors: ChartColors,
  intervalSeconds = 60,
  usdPerEth?: number | null,
) {
  const times = candles.map((candle) => candle.time);
  const latest = candles.at(-1);
  const axisLine = { show: false };
  const axisTick = { show: false };

  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: {
      color: colors.text,
      fontFamily: '"DM Sans", system-ui, sans-serif',
    },
    grid: [
      { left: 12, right: 96, top: 18, height: "64%", containLabel: false },
      { left: 12, right: 96, top: "74%", height: "17%", containLabel: false },
    ],
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    tooltip: {
      trigger: "axis" as const,
      showContent: false,
      axisPointer: {
        type: "cross" as const,
        lineStyle: { color: colors.text, type: "dashed" as const },
      },
    },
    xAxis: [0, 1].map((gridIndex) => ({
      type: "category" as const,
      gridIndex,
      data: times,
      boundaryGap: true,
      axisLine,
      axisTick,
      axisLabel: {
        show: gridIndex === 1,
        color: colors.text,
        hideOverlap: true,
        margin: 12,
        formatter: (value: number) =>
          intervalSeconds >= 86_400
            ? new Date(Number(value) * 1000).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })
            : new Date(Number(value) * 1000).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }),
      },
      splitLine: { show: false },
      axisPointer: { show: true, label: { show: false } },
    })),
    yAxis: [
      {
        type: "value" as const,
        gridIndex: 0,
        position: "right" as const,
        scale: true,
        splitNumber: 5,
        min: (range: { min: number; max: number }) =>
          range.min -
          Math.max((range.max - range.min) * 0.08, range.min * 0.01),
        max: (range: { min: number; max: number }) =>
          range.max +
          Math.max((range.max - range.min) * 0.08, range.max * 0.01),
        axisLine,
        axisTick,
        axisLabel: {
          color: colors.text,
          margin: 14,
          formatter: (value: number) => formatMarketCap(value, usdPerEth),
        },
        splitLine: { lineStyle: { color: colors.grid } },
        axisPointer: {
          show: true,
          label: {
            formatter: ({ value }: { value: number }) =>
              formatMarketCap(value, usdPerEth),
          },
        },
      },
      {
        type: "value" as const,
        gridIndex: 1,
        position: "right" as const,
        axisLine,
        axisTick,
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      { type: "inside" as const, xAxisIndex: [0, 1], start: 0, end: 100 },
    ],
    series: [
      {
        type: "candlestick" as const,
        name: "Market cap",
        data: candles.map((candle) => [
          candle.open,
          candle.close,
          candle.low,
          candle.high,
        ]),
        barWidth: "58%",
        barMaxWidth: 22,
        itemStyle: {
          color: `${colors.lime}aa`,
          color0: `${colors.orange}aa`,
          borderColor: colors.lime,
          borderColor0: colors.orange,
          borderWidth: 1,
        },
        markLine: latest
          ? {
              symbol: "none",
              silent: true,
              lineStyle: {
                color: colors.lime,
                type: "dashed" as const,
                width: 1,
                opacity: 0.65,
              },
              label: {
                show: true,
                position: "end" as const,
                formatter: formatMarketCap(latest.close, usdPerEth),
                color: "#10170f",
                backgroundColor: colors.lime,
                padding: [5, 8],
                borderRadius: 3,
              },
              data: [{ yAxis: latest.close }],
            }
          : undefined,
      },
      {
        type: "bar" as const,
        name: "Volume",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: candles.map((candle) => candle.volume),
        barWidth: "58%",
        barMaxWidth: 22,
        itemStyle: {
          color: (params: { dataIndex: number }) =>
            candles[params.dataIndex].close >= candles[params.dataIndex].open
              ? `${colors.lime}55`
              : `${colors.orange}55`,
        },
      },
    ],
  };
}
