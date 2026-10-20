import { getAccessToken } from "@privy-io/react-auth";
import { getAccount } from "@wagmi/core";
import { getAddress, type Address } from "viem";
import { wagmiConfig } from "../lib/web3";
import type {
  FollowingActivity,
  ModerationReport,
  LeaderboardSnapshot,
  Notification,
  NotificationPreferences,
  PulsePeriod,
  PulseResponse,
  PulseScope,
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
    launchpadAddress: getAddress(String(row.launchpad_address)),
    note: typeof row.note === "string" ? row.note : null,
    reactionCount: Number(row.reaction_count || 0),
    reacted: Boolean(row.reacted),
    followerCount: Number(row.follower_count || 0),
    isFollowed: Boolean(row.is_followed),
  };
}

function mapNotification(row: Record<string, unknown>): Notification {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    kind: String(row.kind) as Notification["kind"],
    actorAddress: typeof row.actor_address === "string" ? getAddress(row.actor_address) : null,
    tokenAddress: typeof payload.tokenAddress === "string" ? getAddress(payload.tokenAddress) : null,
    tokenName: typeof payload.tokenName === "string" ? payload.tokenName : null,
    tokenSymbol: typeof payload.tokenSymbol === "string" ? payload.tokenSymbol : null,
    milestone: typeof payload.milestone === "number" ? payload.milestone : null,
    readAt: typeof row.read_at === "string" ? row.read_at : null,
    createdAt: String(row.created_at),
  };
}

export const socialApi = {
  /** Confirms the signed-in wallet with the API, which claims its profile on first sign-in. */
  async me() {
    return api<{ address: Address | null }>("/v1/me", { method: "POST" });
  },
  async feed(scope: "global" | "following" = "global", cursor?: string, trader?: Address) {
    const query = new URLSearchParams({ scope, limit: "30" });
    if (cursor) query.set("cursor", cursor);
    if (trader) query.set("trader", trader);
    const result = await api<{ items: Record<string, unknown>[]; nextCursor: string | null }>(`/v1/feed?${query}`);
    return { ...result, items: result.items.map(mapTrade) };
  },
  pulse(scope: PulseScope, period: PulsePeriod) {
    const query = new URLSearchParams({ scope, period });
    return api<PulseResponse>(`/v1/pulse?${query}`);
  },
  followingActivity() {
    return api<{ scope: "following"; followedCount: number; items: FollowingActivity[] }>("/v1/following/activity");
  },
  leaderboard(category: "consistent" | "new") {
    return api<LeaderboardSnapshot>(`/v1/leaderboards/${category}`);
  },
  profile(address: Address) {
    return api<TraderProfile>(`/v1/profiles/${address}`);
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
  moderationReports(status: "open" | "reviewing" | "actioned" | "dismissed" | "all" = "open") {
    return api<{ items: ModerationReport[] }>(`/v1/admin/reports?status=${status}`);
  },
  async notifications(limit = 30) {
    const result = await api<{ items: Record<string, unknown>[]; unreadCount: number }>(`/v1/notifications?limit=${limit}`);
    return { items: result.items.map(mapNotification), unreadCount: result.unreadCount };
  },
  markNotificationsRead(ids: string[]) {
    return api<{ ok: true }>("/v1/notifications/read", { method: "PATCH", body: { ids } });
  },
  async notificationPreferences() {
    const row = await api<{ in_app: boolean; trade_buys: boolean; trade_sells: boolean; launches: boolean; graduations: boolean; new_followers: boolean }>("/v1/notification-preferences");
    return {
      inApp: row.in_app,
      tradeBuys: row.trade_buys,
      tradeSells: row.trade_sells,
      launches: row.launches,
      graduations: row.graduations,
      newFollowers: row.new_followers,
    } satisfies NotificationPreferences;
  },
  async updateNotificationPreferences(preferences: NotificationPreferences) {
    const row = await api<{ in_app: boolean; trade_buys: boolean; trade_sells: boolean; launches: boolean; graduations: boolean; new_followers: boolean }>("/v1/notification-preferences", {
      method: "PATCH",
      body: preferences,
    });
    return {
      inApp: row.in_app,
      tradeBuys: row.trade_buys,
      tradeSells: row.trade_sells,
      launches: row.launches,
      graduations: row.graduations,
      newFollowers: row.new_followers,
    } satisfies NotificationPreferences;
  },
  updateModerationReport(id: string, status: "reviewing" | "actioned" | "dismissed", resolutionNote: string) {
    return api<{ id: string; status: string; resolution_note: string; resolved_at: string | null }>(`/v1/admin/reports/${id}`, {
      method: "PATCH",
      body: { status, resolutionNote },
    });
  },
};
