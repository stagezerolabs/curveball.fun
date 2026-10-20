import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { socialApi, socialApiBaseUrl, socialApiConfigured } from "./api";
import type { NotificationPreferences } from "./types";

/** The viewer's inbox. The SSE stream nudges it, and the interval is only a backstop. */
export function useNotifications(address: Address | undefined, enabled = true) {
  return useQuery({
    queryKey: ["social", "notifications", address?.toLowerCase()],
    queryFn: () => socialApi.notifications(),
    enabled: enabled && socialApiConfigured && Boolean(address),
    staleTime: 20_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function useNotificationPreferences(enabled = true) {
  return useQuery({
    queryKey: ["social", "notification-preferences"],
    queryFn: () => socialApi.notificationPreferences(),
    enabled: enabled && socialApiConfigured,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export async function saveNotificationPreferences(queryClient: ReturnType<typeof useQueryClient>, preferences: NotificationPreferences) {
  const saved = await socialApi.updateNotificationPreferences(preferences);
  queryClient.setQueryData(["social", "notification-preferences"], saved);
  return saved;
}

const STREAM_EVENTS = ["launch", "trade", "graduation"];
const FEED_REFRESH_MS = 10_000;
const INBOX_REFRESH_MS = 30_000;

/**
 * Keeps indexed reads live without polling every panel: any chain event refreshes Pulse, market and
 * leaderboard data, and nudges the viewer's inbox less often because it is the least urgent.
 */
export function useSocialStream(enabled = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || !socialApiConfigured || typeof EventSource === "undefined") return undefined;
    const source = new EventSource(`${socialApiBaseUrl}/v1/events`);
    let lastFeeds = 0;
    let lastInbox = 0;
    const onEvent = () => {
      const now = Date.now();
      if (now - lastFeeds >= FEED_REFRESH_MS) {
        lastFeeds = now;
        void queryClient.invalidateQueries({ queryKey: ["social"] });
        void queryClient.invalidateQueries({ queryKey: ["markets"] });
      }
      if (now - lastInbox >= INBOX_REFRESH_MS) {
        lastInbox = now;
        void queryClient.invalidateQueries({ queryKey: ["social", "notifications"] });
      }
    };
    for (const name of STREAM_EVENTS) source.addEventListener(name, onEvent);
    // A dropped stream reconnects on its own; per-query intervals keep data moving meanwhile.
    source.onerror = () => undefined;
    return () => {
      for (const name of STREAM_EVENTS) source.removeEventListener(name, onEvent);
      source.close();
    };
  }, [enabled, queryClient]);
}
