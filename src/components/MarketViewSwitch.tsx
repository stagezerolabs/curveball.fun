import {
  SegmentedControl,
  type SegmentedControlOption,
} from "./SegmentedControl";

export type MarketView = "cards" | "rows";

const views: readonly SegmentedControlOption<MarketView>[] = [
  {
    value: "cards",
    label: (
      <>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <rect x="2.5" y="2.5" width="6" height="6" rx="1" />
          <rect x="11.5" y="2.5" width="6" height="6" rx="1" />
          <rect x="2.5" y="11.5" width="6" height="6" rx="1" />
          <rect x="11.5" y="11.5" width="6" height="6" rx="1" />
        </svg>
        Cards
      </>
    ),
  },
  {
    value: "rows",
    label: (
      <>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M3 4h2M8 4h9M3 10h2m3 0h9M3 16h2m3 0h9" />
        </svg>
        Rows
      </>
    ),
  },
];

export function MarketViewSwitch({
  value,
  onChange,
}: {
  value: MarketView;
  onChange: (value: MarketView) => void;
}) {
  return (
    <SegmentedControl
      className="market-view-switch"
      label="Market view"
      value={value}
      options={views}
      onChange={onChange}
    />
  );
}
