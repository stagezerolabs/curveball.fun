import { describe, expect, test } from "bun:test";
import { buildMarketChartOptions } from "./marketChartOptions";

const colors = {
  text: "#8d978f",
  grid: "#202820",
  lime: "#c8f135",
  orange: "#fe5d26",
};

describe("market chart options", () => {
  test("maps OHLC values in ECharts order and keeps volume in its own pane", () => {
    const options = buildMarketChartOptions(
      [
        { time: 60, open: 2, high: 4, low: 1, close: 3, volume: 7 },
        { time: 120, open: 3, high: 5, low: 2, close: 2, volume: 9 },
      ],
      colors,
    );

    expect(options.series[0].data).toEqual([
      [2, 3, 1, 4],
      [3, 2, 2, 5],
    ]);
    expect(options.series[1].data).toEqual([7, 9]);
    expect(options.series[1].xAxisIndex).toBe(1);
    expect(options.series[1].yAxisIndex).toBe(1);
    expect(options.series[0].itemStyle.borderColor).toBe(colors.lime);
    expect(options.series[0].itemStyle.borderColor0).toBe(colors.orange);
  });

  test("labels daily candles with dates", () => {
    const options = buildMarketChartOptions(
      [{ time: 1_728_000, open: 2, high: 2, low: 2, close: 2, volume: 1 }],
      colors,
      86_400,
    );

    expect(options.xAxis[1].axisLabel.formatter(1_728_000)).toContain("Jan");
  });

  test("shows USD on the price axis when an exchange rate is available", () => {
    const options = buildMarketChartOptions(
      [{ time: 60, open: 2, high: 3, low: 1, close: 2, volume: 1 }],
      colors,
      60,
      2_000,
    );

    expect(options.yAxis[0].axisLabel.formatter?.(2)).toBe("$4K");
    expect(options.series[0].markLine?.label.formatter).toBe("$4K");
  });
});
