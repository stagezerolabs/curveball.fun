export function marketSlugBase(symbol) {
  return (
    String(symbol)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80)
      .replace(/-$/, "") || "token"
  );
}

export function duplicateMarketSlug(base, address) {
  return `${base}--${address.toLowerCase().replace(/^0x/, "")}`;
}
