export function formatEthAmount(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value === 0) return "0";
  if (Math.abs(value) < 0.0001) return value.toExponential(2);
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "0%";
  return `${Math.min(100, Math.max(0, value)).toFixed(1)}%`;
}

export function formatAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatRelativeTime(value) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  const units = [
    ["d", 86400],
    ["h", 3600],
    ["m", 60],
  ];
  for (const [suffix, size] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${suffix} ago`;
  }
  return "just now";
}

export function formatCompact(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (Math.abs(value) < 1000) return formatEthAmount(value);
  return value.toLocaleString(undefined, {
    notation: "compact",
    maximumFractionDigits: 2,
  });
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 6,
});

const compactUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

export function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return usdFormatter.format(value);
}

export function formatUsdCompact(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return compactUsdFormatter.format(value);
}

// "+70.9%" / "-22.7%" / "+<0.1%" / "0%" — tiny moves stay visibly non-zero
// instead of rounding to "+0.0%".
export function formatChange(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value === 0) return "0%";
  const sign = value > 0 ? "+" : "-";
  const magnitude = Math.abs(value);
  if (magnitude < 0.1) return `${sign}<0.1%`;
  return `${sign}${magnitude.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function changeTone(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "flat";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

export function formatCount(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString();
}
