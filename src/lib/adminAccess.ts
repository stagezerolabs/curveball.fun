import { getAddress, isAddress, type Address } from "viem";

const configuredAdmin = String(import.meta.env.VITE_ADMIN_ADDRESS || "").trim();
if (!configuredAdmin) throw new Error("VITE_ADMIN_ADDRESS is required.");
if (!isAddress(configuredAdmin))
  throw new Error("VITE_ADMIN_ADDRESS must be a valid Ethereum address.");

export const ADMIN_ADDRESS: Address = getAddress(configuredAdmin);

export function isAdminAddress(address?: Address): address is Address {
  return address?.toLowerCase() === ADMIN_ADDRESS.toLowerCase();
}
