import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MouseEvent, ReactNode } from "react";
import type { Address } from "viem";
import { routeHref } from "../app/routeTree";
import { formatAddress, formatRelativeTime } from "../lib/format.js";
import { socialApi, socialApiConfigured } from "../social/api";
import type { NotificationItem } from "../social/types";
import type { Navigate } from "../types";

function NotificationLink({ address, navigate, children }: { address: Address; navigate: Navigate; children: ReactNode }) {
  return <a href={routeHref("market", { address })} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate("market", { address });
  }}>{children}</a>;
}

function notificationCopy(item: NotificationItem) {
  const token = item.payload.tokenName || item.payload.tokenSymbol || "A token";
  const trader = item.payload.actorDisplayName
    || (item.actor_address ? formatAddress(item.actor_address) : "A trader you follow");
  if (item.kind === "followed_buy") return { badge: "Buy", text: `${trader} bought ${token}` };
  if (item.kind === "followed_sell") return { badge: "Sell", text: `${trader} sold ${token}` };
  const milestone = item.payload.milestone ?? 100;
  return { badge: `${milestone}%`, text: `${token} reached ${milestone}% of its curve sold` };
}

export function NotificationsPopover({ address, navigate }: { address: Address; navigate: Navigate }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["social", "notifications", address.toLowerCase()] as const;
  const notifications = useQuery({
    queryKey,
    queryFn: () => socialApi.notifications(8),
    enabled: socialApiConfigured,
    retry: false,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const markRead = useMutation({
    mutationFn: (ids: string[]) => socialApi.markNotificationsRead(ids),
    onSuccess: (_result, ids) => {
      const readAt = new Date().toISOString();
      queryClient.setQueryData<{ items: NotificationItem[] }>(queryKey, (current) => current ? {
        items: current.items.map((item) => ids.includes(item.id) ? { ...item, read_at: readAt } : item),
      } : current);
    },
  });
  const unreadCount = notifications.data?.items.filter((item) => !item.read_at).length ?? 0;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    void notifications.refetch().then(({ data }) => {
      const ids = data?.items.filter((item) => !item.read_at).map((item) => item.id) ?? [];
      if (ids.length) markRead.mutate(ids);
    });
  }

  const go: Navigate = (route, params) => {
    setOpen(false);
    navigate(route, params);
  };

  return <Popover.Root open={open} onOpenChange={handleOpenChange}>
    <Popover.Trigger
      className="nav-profile nav-notifications"
      aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
      title="Notifications"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 6 2.5 6 2.5 7.5H4C4 15 6.5 15 6.5 9Z" /><path d="M10 20h4" /></svg>
      {unreadCount ? <span className="notification-unread-badge" aria-hidden="true" /> : null}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner className="notifications-popover-positioner" sideOffset={10} align="end" collisionPadding={12}>
        <Popover.Popup className="notifications-popover" aria-busy={notifications.isLoading}>
          <header>
            <Popover.Title>Notifications</Popover.Title>
            <Popover.Close className="notifications-popover-close" aria-label="Close notifications">×</Popover.Close>
          </header>
          {notifications.isLoading ? <div className="notifications-popover-loading" aria-label="Loading notifications"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
            : notifications.isError ? <div className="notifications-popover-state" role="alert"><strong>Notifications unavailable</strong><button type="button" onClick={() => void notifications.refetch()}>Try again</button></div>
              : !notifications.data?.items.length ? <div className="notifications-popover-state"><strong>You’re all caught up</strong><p>Follow traders to see their buys, sells, and token milestones here.</p></div>
                : <ol className="notifications-popover-list">{notifications.data.items.map((item) => {
                  const copy = notificationCopy(item);
                  const content = <>
                    <span className={`notification-kind ${item.kind}`} aria-hidden="true">{copy.badge}</span>
                    <span><strong>{copy.text}</strong><time dateTime={item.created_at}>{formatRelativeTime(item.created_at)}</time></span>
                    {!item.read_at ? <i className="notification-unread-dot" aria-label="Unread" /> : null}
                  </>;
                  return <li key={item.id}>{item.payload.tokenAddress
                    ? <NotificationLink address={item.payload.tokenAddress} navigate={go}>{content}</NotificationLink>
                    : <div>{content}</div>}
                  </li>;
                })}</ol>}
          <footer><button type="button" onClick={() => { setOpen(false); navigate("profile"); }}>Notification settings</button></footer>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
