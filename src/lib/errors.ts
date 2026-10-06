export function readableError(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (!(error instanceof Error)) return fallback;

  const detail = error.message || "";
  if (/user rejected|user denied|request rejected|rejected the request/i.test(detail)) {
    return "Request cancelled in your wallet.";
  }
  if (/block not found|requested resource not found/i.test(detail)) {
    return "The network is still syncing the latest block. Wait a moment and try again.";
  }
  if (/failed to fetch|network error|timed? out|http request failed/i.test(detail)) {
    return "The network did not respond. Check your connection and try again.";
  }

  const shortMessage = "shortMessage" in error
    ? String((error as Error & { shortMessage?: unknown }).shortMessage ?? "")
    : "";
  const firstLine = (shortMessage || detail).split("\n", 1)[0]?.trim();
  if (!firstLine) return fallback;
  return firstLine.length > 220 ? `${firstLine.slice(0, 217)}…` : firstLine;
}
