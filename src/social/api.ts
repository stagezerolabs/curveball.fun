import { getAccessToken } from "@privy-io/react-auth";
import { getAccount } from "@wagmi/core";
import { getAddress, type Address } from "viem";
import { assertFollowingBuysResponse, assertNotificationsResponse, assertPageResponse, parseFollowingPeriod, parseProfileUpdate, parseReportBody, parseNotificationPreferencesPatch } from "../../packages/social-contract/index.mjs";
import { wagmiConfig } from "../lib/web3";
import type {
  FollowingBuy,
  NotificationItem,
  ModerationReport,
  LeaderboardSnapshot,
  PulsePeriod,
  PulseResponse,
  PulseScope,
  SocialTrade,
  TraderProfile,
  TraderSummary,
  Page,
  NotificationPage,
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
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    note: typeof row.note === "string" ? row.note : null,
    reactionCount: Number(row.reaction_count || 0),
    reacted: Boolean(row.reacted),
    followerCount: Number(row.follower_count || 0),
    isFollowed: Boolean(row.is_followed),
    discoverable: Boolean(row.discoverable),
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
  followingBuys(period: PulsePeriod) {
    return api<{ scope: "following"; period: PulsePeriod; items: FollowingBuy[] }>(`/v1/following/buys?period=${parseFollowingPeriod(period)}`).then((result) => assertFollowingBuysResponse<typeof result>(result));
  },
  leaderboard(category: LeaderboardSnapshot["category"]) {
    return api<LeaderboardSnapshot>(`/v1/leaderboards/${category}`);
  },
  profile(address: Address) {
    return api<TraderProfile>(`/v1/profiles/${address}`);
  },
  discoverTraders(search = "", cursor?: string) {
    const query = new URLSearchParams({ search, limit: "20" });
    if (cursor) query.set("cursor", cursor);
    return api<Page<TraderSummary>>(`/v1/profiles?${query}`).then((result) => assertPageResponse<typeof result>(result));
  },
  profileConnections(address: Address, kind: "followers" | "following", cursor?: string) {
    const query = new URLSearchParams({ limit: "20" });
    if (cursor) query.set("cursor", cursor);
    return api<Page<TraderSummary>>(`/v1/profiles/${address}/${kind}?${query}`).then((result) => assertPageResponse<typeof result>(result));
  },
  saveProfile(input: { displayName: string; bio: string; discoverable: boolean }) {
    return api<TraderProfile>("/v1/profiles/me", { method: "POST", body: parseProfileUpdate(input) });
  },
  follow(address: Address, following: boolean) {
    return api<{ following: boolean }>(`/v1/follows/${address}`, { method: following ? "POST" : "DELETE" });
  },
  block(address: Address, blocked: boolean) {
    return api<{ blocked: boolean }>(`/v1/blocks/${address}`, { method: blocked ? "POST" : "DELETE" });
  },
  report(subjectAddress: Address, reason: string, details = "", tradeId?: string) {
    return api<{ ok: true }>("/v1/reports", { method: "POST", body: parseReportBody({ subjectAddress, reason, details, ...(tradeId ? { tradeId } : {}) }) });
  },
  saveTradeNote(tradeId: string, note: string) {
    return api<{ note: string | null }>("/v1/trade-notes", { method: "POST", body: { tradeId, note } });
  },
  reactToTrade(tradeId: string, active: boolean) {
    return api<{ active: boolean; count: number }>("/v1/trade-reactions", { method: "POST", body: { tradeId, active } });
  },
  notifications(limit = 8, cursor?: string) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    return api<NotificationPage>(`/v1/notifications?${query}`).then((result) => assertNotificationsResponse<typeof result>(result));
  },
  notificationPreferences() {
    return api<{ in_app: boolean; trade_buys: boolean; trade_sells: boolean; graduations: boolean; new_followers: boolean }>("/v1/notification-preferences");
  },
  saveNotificationPreferences(input: { inApp: boolean; tradeBuys: boolean; tradeSells: boolean; graduations: boolean; newFollowers: boolean }) {
    return api<{ in_app: boolean; trade_buys: boolean; trade_sells: boolean; graduations: boolean; new_followers: boolean }>("/v1/notification-preferences", { method: "PATCH", body: parseNotificationPreferencesPatch(input) });
  },
  markNotificationsRead(ids: string[]) {
    return api<{ ok: true }>("/v1/notifications/read", { method: "PATCH", body: { ids } });
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
