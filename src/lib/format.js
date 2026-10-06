export function formatEthAmount(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value === 0) return "0";
  const absolute = Math.abs(value);
  const maximumFractionDigits = absolute < 0.00000001 ? 12 : absolute < 0.0001 ? 8 : 4;
  const formatted = value.toLocaleString(undefined, { maximumFractionDigits });
  if (formatted !== "0") return formatted;
  return maximumFractionDigits === 12 ? "<0.000000000001" : "<0.00000001";
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
