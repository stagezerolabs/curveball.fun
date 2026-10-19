import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { NotificationLink, NotificationMarketLink, notificationCopy } from "../components/NotificationsPopover";
import { formatRelativeTime } from "../lib/format.js";
import { socialApi, socialApiConfigured } from "../social/api";
import type { Navigate } from "../types";

export function NotificationsPage({ navigate }: { navigate: Navigate }) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const inbox = useInfiniteQuery({
    queryKey: ["social", "notifications-inbox", address?.toLowerCase()],
    queryFn: ({ pageParam }) => socialApi.notifications(20, pageParam || undefined),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: socialApiConfigured && Boolean(address),
    refetchInterval: 30_000,
  });
  const markRead = useMutation({ mutationFn: (id: string) => socialApi.markNotificationsRead([id]), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["social", "notifications", address?.toLowerCase()] }), inbox.refetch()]); } });
  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];
  return <main className="notifications-page wrap"><header><h1>Notifications</h1><p>{inbox.data?.pages[0]?.unreadCount ?? 0} unread</p></header>
    {!socialApiConfigured ? <p className="social-feed-state">Notifications are unavailable on this deployment.</p>
      : !address ? <p className="social-feed-state">Connect a linked wallet to view notifications.</p>
      : inbox.isPending ? <p role="status">Loading notifications…</p>
        : inbox.isError ? <div className="social-feed-state" role="alert"><strong>Notifications are unavailable.</strong><p>{inbox.error.message}</p><button type="button" onClick={() => void inbox.refetch()}>Try again</button></div>
          : items.length ? <ol className="notifications-inbox-list">{items.map((item) => {
            const copy = notificationCopy(item);
            return <li key={item.id} className={item.read_at ? "" : "unread"}><NotificationLink item={item} navigate={navigate} onOpen={() => { if (!item.read_at) markRead.mutate(item.id); }}><span className={`notification-kind ${item.kind}`} aria-hidden="true">{copy.badge}</span><span><strong>{copy.text}</strong><time dateTime={item.created_at}>{formatRelativeTime(item.created_at)}</time></span>{!item.read_at ? <span className="visually-hidden">Unread</span> : null}</NotificationLink><NotificationMarketLink item={item} navigate={navigate} /></li>;
          })}</ol> : <p className="social-feed-state">No notifications yet.</p>}
    {inbox.hasNextPage ? <button type="button" className="profile-secondary-action social-load-more" disabled={inbox.isFetchingNextPage} onClick={() => void inbox.fetchNextPage()}>{inbox.isFetchingNextPage ? "Loading…" : "Load more notifications"}</button> : null}
  </main>;
}
