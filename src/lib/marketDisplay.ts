export function formatMarketAge(createdAt: string) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, (Date.now() - timestamp) / 1_000);
  if (seconds >= 31_536_000) return `${Math.floor(seconds / 31_536_000)}y`;
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return "now";
}

export function formatMarketCount(value: number | undefined) {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}
