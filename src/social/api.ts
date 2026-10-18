import { getAccessToken } from "@privy-io/react-auth";
import { getAccount } from "@wagmi/core";
import { getAddress, type Address } from "viem";
import { wagmiConfig } from "../lib/web3";
import type {
  NotificationItem,
  ModerationReport,
  SocialTrade,
  TraderProfile,
} from "./types";
const configuredBaseUrl = String(import.meta.env.VITE_SOCIAL_API_URL || "").trim().replace(/\/$/, "");
export const socialApiBaseUrl = configuredBaseUrl;
export const socialApiConfigured = Boolean(socialApiBaseUrl);
const ACTIVE_WALLET_HEADER = "X-Curveball-Wallet-Address";

type ApiOptions = Omit<RequestInit, "body"> & { body?: BodyInit | Record<string, unknown> | null };

async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  if (!socialApiConfigured) throw new Error("Curveball social is not configured for this deployment.");
  const [accessToken, account] = await Promise.all([
    getAccessToken().catch(() => null),
    Promise.resolve(getAccount(wagmiConfig)),
  ]);
  const body = options.body && typeof options.body === "object" && !(options.body instanceof FormData) && !(options.body instanceof Blob)
    ? JSON.stringify(options.body)
    : options.body;
  const response = await fetch(`${socialApiBaseUrl}${path}`, {
    ...options,
    body: body as BodyInit | null | undefined,
    credentials: "omit",
    headers: {
      ...(body && typeof body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(accessToken && account.address ? {
        Authorization: `Bearer ${accessToken}`,
        [ACTIVE_WALLET_HEADER]: account.address,
      } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Social request failed (${response.status}).`);
  return payload as T;
}

function mapTrade(row: Record<string, unknown>): SocialTrade {
  return {
    id: String(row.id),
    traderAddress: getAddress(String(row.trader_address)),
    isBuy: Boolean(row.is_buy),
    quoteAmountWei: String(row.quote_amount_wei),
    tokenAmountWei: String(row.token_amount_wei),
    virtualQuoteAfter: String(row.virtual_quote_after),
    virtualTokenAfter: String(row.virtual_token_after),
    transactionHash: String(row.transaction_hash) as `0x${string}`,
    logIndex: Number(row.log_index),
    blockTimestamp: String(row.block_timestamp),
    tokenAddress: getAddress(String(row.token_address)),
    tokenName: String(row.token_name),
    tokenSymbol: String(row.token_symbol),
    curveAddress: getAddress(String(row.curve_address)),
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    note: typeof row.note === "string" ? row.note : null,
    reactionCount: Number(row.reaction_count || 0),
    reacted: Boolean(row.reacted),
    followerCount: Number(row.follower_count || 0),
    isFollowed: Boolean(row.is_followed),
  };
}

export const socialApi = {
  async me() {
    return api<{ address: Address | null }>("/v1/me");
  },
  async feed(scope: "global" | "following" = "global", cursor?: string, trader?: Address) {
    const query = new URLSearchParams({ scope, limit: "30" });
    if (cursor) query.set("cursor", cursor);
    if (trader) query.set("trader", trader);
    const result = await api<{ items: Record<string, unknown>[]; nextCursor: string | null }>(`/v1/feed?${query}`);
    return { ...result, items: result.items.map(mapTrade) };
  },
  profile(address: Address) {
    return api<TraderProfile>(`/v1/profiles/${address}`);
  },
  saveProfile(input: { displayName: string; bio: string; discoverable: boolean }) {
    return api<TraderProfile>("/v1/profiles/me", { method: "POST", body: input });
  },
  follow(address: Address, following: boolean) {
    return api<{ following: boolean }>(`/v1/follows/${address}`, { method: following ? "POST" : "DELETE" });
  },
  block(address: Address, blocked: boolean) {
    return api<{ blocked: boolean }>(`/v1/blocks/${address}`, { method: blocked ? "POST" : "DELETE" });
  },
  report(subjectAddress: Address, reason: string, details = "") {
    return api<{ ok: true }>("/v1/reports", { method: "POST", body: { subjectAddress, reason, details } });
  },
  saveTradeNote(tradeId: string, note: string) {
    return api<{ note: string | null }>("/v1/trade-notes", { method: "POST", body: { tradeId, note } });
  },
  reactToTrade(tradeId: string, active: boolean) {
    return api<{ active: boolean; count: number }>("/v1/trade-reactions", { method: "POST", body: { tradeId, active } });
  },
  notifications(limit = 8) {
    return api<{ items: NotificationItem[] }>(`/v1/notifications?limit=${limit}`);
  },
  notificationPreferences() {
    return api<{ in_app: boolean; trade_buys: boolean; trade_sells: boolean; graduations: boolean }>("/v1/notification-preferences");
  },
  saveNotificationPreferences(input: { inApp: boolean; tradeBuys: boolean; tradeSells: boolean; graduations: boolean }) {
    return api<{ in_app: boolean; trade_buys: boolean; trade_sells: boolean; graduations: boolean }>("/v1/notification-preferences", { method: "PATCH", body: input });
  },
  markNotificationsRead(ids: string[]) {
    return api<{ ok: true }>("/v1/notifications/read", { method: "PATCH", body: { ids: ids.map(Number) } });
  },
  moderationReports(status: "open" | "reviewing" | "actioned" | "dismissed" | "all" = "open") {
    return api<{ items: ModerationReport[] }>(`/v1/admin/reports?status=${status}`);
  },
  updateModerationReport(id: string, status: "reviewing" | "actioned" | "dismissed", resolutionNote: string) {
    return api<{ id: string; status: string; resolution_note: string; resolved_at: string | null }>(`/v1/admin/reports/${id}`, {
      method: "PATCH",
      body: { status, resolutionNote },
    });
  },
};
