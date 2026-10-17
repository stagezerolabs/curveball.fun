import type { MarketCandle } from "./marketChart";

type ChartColors = {
  text: string;
  grid: string;
  lime: string;
  orange: string;
};

function formatMarketCap(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-US", {
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 4,
  })} WETH`;
}

export function buildMarketChartOptions(candles: readonly MarketCandle[], colors: ChartColors, intervalSeconds = 60) {
  const times = candles.map((candle) => candle.time);
  const latest = candles.at(-1);
  const axisLine = { show: false };
  const axisTick = { show: false };

  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { color: colors.text, fontFamily: '"DM Sans", system-ui, sans-serif' },
    grid: [
      { left: 8, right: 92, top: 12, height: "72%", containLabel: false },
      { left: 8, right: 92, top: "79%", height: "13%", containLabel: false },
    ],
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    tooltip: {
      trigger: "axis" as const,
      showContent: false,
      axisPointer: { type: "cross" as const, lineStyle: { color: colors.text, type: "dashed" as const } },
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
        formatter: (value: number) => intervalSeconds >= 86_400
          ? new Date(Number(value) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : new Date(Number(value) * 1000).toLocaleTimeString("en-US", {
            hour: "2-digit", minute: "2-digit", hour12: false,
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
        axisLine,
        axisTick,
        axisLabel: { color: colors.text, margin: 14, formatter: (value: number) => formatMarketCap(value) },
        splitLine: { lineStyle: { color: colors.grid } },
        axisPointer: { show: true, label: { formatter: ({ value }: { value: number }) => formatMarketCap(value) } },
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
    dataZoom: [{ type: "inside" as const, xAxisIndex: [0, 1], start: 0, end: 100 }],
    series: [
      {
        type: "candlestick" as const,
        name: "Market cap",
        data: candles.map((candle) => [candle.open, candle.close, candle.low, candle.high]),
        barWidth: "55%",
        itemStyle: {
          color: colors.lime,
          color0: colors.orange,
          borderColor: colors.lime,
          borderColor0: colors.orange,
        },
        markLine: latest ? {
          symbol: "none",
          silent: true,
          lineStyle: { color: colors.lime, type: "dashed" as const, width: 1 },
          label: {
            show: true,
            position: "end" as const,
            formatter: formatMarketCap(latest.close),
            color: "#10170f",
            backgroundColor: colors.lime,
            padding: [5, 8],
            borderRadius: 3,
          },
          data: [{ yAxis: latest.close }],
        } : undefined,
      },
      {
        type: "bar" as const,
        name: "Volume",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: candles.map((candle) => candle.volume),
        barWidth: "55%",
        itemStyle: {
          color: (params: { dataIndex: number }) =>
            candles[params.dataIndex].close >= candles[params.dataIndex].open
              ? `${colors.lime}55` : `${colors.orange}55`,
        },
      },
    ],
  };
}
