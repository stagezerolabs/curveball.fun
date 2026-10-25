import {
  SegmentedControl,
  type SegmentedControlOption,
} from "./SegmentedControl";

export type MarketStatusFilterValue = "all" | "curve" | "graduated";

const filters: readonly SegmentedControlOption<MarketStatusFilterValue>[] = [
  { value: "all", label: "All" },
  { value: "curve", label: "On the curve" },
  { value: "graduated", label: "Graduated" },
];

export function MarketStatusFilter({
  value,
  onChange,
}: {
  value: MarketStatusFilterValue;
  onChange: (value: MarketStatusFilterValue) => void;
}) {
  return (
    <SegmentedControl
      className="market-filter-group"
      label="Market status"
      value={value}
      options={filters}
      onChange={onChange}
    />
  );
}
