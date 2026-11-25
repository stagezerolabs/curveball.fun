const hiddenMarketAddress = "0xce4b88c65e3c1f57ba43c1f6a3536ae15d6af299";

export function isHiddenMarketAddress(address: string | null | undefined): boolean {
  return address?.toLowerCase() === hiddenMarketAddress;
}
