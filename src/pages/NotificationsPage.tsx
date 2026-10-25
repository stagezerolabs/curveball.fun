import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { AppLink } from "../components/Navigation";
import { formatRelativeTime } from "../lib/format.js";
import { socialApi, socialApiConfigured } from "../social/api";
import { TraderName } from "../social/TraderIdentity";
import {
  useNotificationPreferences,
  useNotifications,
  saveNotificationPreferences,
} from "../social/useNotifications";
import type { Notification, NotificationPreferences } from "../social/types";
import type { Navigate } from "../types";
import { selectProfileAuthView } from "./profileAuthGate";

const PREFERENCE_FIELDS: {
  key: keyof NotificationPreferences;
  label: string;
  hint: string;
}[] = [
  {
    key: "inApp",
    label: "In-app notifications",
    hint: "Turn every inbox alert off at once.",
  },
  {
    key: "tradeBuys",
    label: "Followed buys",
    hint: "A wallet you follow bought a token.",
  },
  {
    key: "tradeSells",
    label: "Followed sells",
    hint: "A wallet you follow sold a token.",
  },
  {
    key: "launches",
    label: "Followed launches",
    hint: "A wallet you follow created a token.",
  },
  {
    key: "graduations",
    label: "Curve milestones and graduations",
    hint: "Your coins and followed coins advancing on the curve.",
  },
  {
    key: "newFollowers",
    label: "New followers",
    hint: "A wallet started following you.",
  },
];

function describe(notification: Notification) {
  const token = notification.tokenName ?? notification.tokenSymbol;
  switch (notification.kind) {
    case "followed_buy":
      return `bought ${token ?? "a token"}`;
    case "followed_sell":
      return `sold ${token ?? "a token"}`;
    case "followed_launch":
      return `launched ${token ?? "a token"}`;
    case "new_follower":
      return "started following you";
    case "reaction":
      return `showed Conviction on your trade${token ? ` of ${token}` : ""}`;
    case "curve_milestone":
      return `${token ?? "A token"} passed ${notification.milestone ?? 0}% of its curve`;
    case "graduation":
      return `${token ?? "A token"} graduated to the pool`;
  }
}

/** Conviction and curve progress come from other people, so they read without an actor wallet. */
function hasActor(notification: Notification) {
  return (
    Boolean(notification.actorAddress) &&
    notification.kind !== "curve_milestone" &&
    notification.kind !== "graduation"
  );
}

export function NotificationsPage({ navigate }: { navigate: Navigate }) {
  const { address } = useAccount();
  const { ready: privyReady, authenticated, login } = usePrivy();
  const queryClient = useQueryClient();
  const inbox = useNotifications(address);
  const preferences = useNotificationPreferences(Boolean(address));
  const [notice, setNotice] = useState("");

  const markRead = useMutation({
    mutationFn: (ids: string[]) => socialApi.markNotificationsRead(ids),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["social", "notifications"] }),
    onError: () =>
      setNotice("Could not update your notifications. Try again shortly."),
  });

  const savePreferences = useMutation({
    mutationFn: (next: NotificationPreferences) =>
      saveNotificationPreferences(queryClient, next),
    onError: () => setNotice("Could not save your notification settings."),
  });

  const view = selectProfileAuthView({
    ready: privyReady,
    authenticated,
    hasAddress: Boolean(address),
  });
  if (!socialApiConfigured && view === "ready") {
    return (
      <main className="page-status wrap">
        <h1>Notifications are not connected</h1>
        <p>Configure the social service before reading alerts.</p>
      </main>
    );
  }
  if (view === "loading" || view === "restoring") {
    return (
      <main
        className="page-main wrap"
        aria-busy="true"
        aria-label="Loading notifications"
      >
        <div className="trader-profile-skeleton skeleton" />
      </main>
    );
  }
  if (view === "login" || !address) {
    return (
      <main className="page-main wrap">
        <section
          className="profile-connect"
          aria-labelledby="notifications-connect-title"
        >
          <span className="profile-connect-icon" aria-hidden="true">
            ↗
          </span>
          <h2 id="notifications-connect-title">Sign in to see notifications</h2>
          <p>
            Followed trades, launches, graduations, followers, and Conviction
            land here.
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={!privyReady}
            onClick={login}
          >
            Create account or sign in
          </button>
        </section>
      </main>
    );
  }

  const items = inbox.data?.items ?? [];
  const unread = items.filter((item) => !item.readAt);

  return (
    <main className="notifications-page wrap">
      {notice ? (
        <p className="notice notice-dismissible" role="status">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </p>
      ) : null}
      <header className="notifications-head">
        <div>
          <h1>Notifications</h1>
          <p>
            {inbox.isPending
              ? "Loading your alerts…"
              : unread.length
                ? `${unread.length} unread`
                : "You are up to date"}
          </p>
        </div>
        {unread.length ? (
          <button
            type="button"
            className="profile-secondary-action"
            disabled={markRead.isPending}
            onClick={() => markRead.mutate(unread.map((item) => item.id))}
          >
            {markRead.isPending ? "Marking…" : "Mark all read"}
          </button>
        ) : null}
      </header>

      <section
        className="notifications-inbox"
        aria-label="Notification inbox"
        aria-busy={inbox.isPending}
      >
        {inbox.isError ? (
          <p className="creator-data-status" role="alert">
            Notifications are unavailable. {inbox.error.message}
          </p>
        ) : inbox.isPending ? (
          <div className="profile-list-skeleton" aria-busy="true">
            {Array.from({ length: 4 }, (_, index) => (
              <span className="skeleton" key={index} />
            ))}
          </div>
        ) : !items.length ? (
          <div className="profile-empty-state">
            <strong>Nothing yet</strong>
            <p>
              Follow traders to hear about their buys, sells, and launches here.
            </p>
            <AppLink
              className="profile-secondary-action"
              route="social"
              navigate={navigate}
            >
              Open Pulse
            </AppLink>
          </div>
        ) : (
          <ul className="notifications-list">
            {items.map((item) => (
              <li key={item.id} className={item.readAt ? "" : "unread"}>
                {!item.readAt ? (
                  <button
                    type="button"
                    className="notifications-read-dot"
                    aria-label="Mark as read"
                    onClick={() => markRead.mutate([item.id])}
                  />
                ) : (
                  <span className="notifications-read-dot" aria-hidden="true" />
                )}
                <p className="notifications-copy">
                  {hasActor(item) ? (
                    <TraderName
                      address={item.actorAddress!}
                      navigate={navigate}
                    />
                  ) : null}
                  <span> {describe(item)}</span>
                  {item.tokenAddress ? (
                    <AppLink
                      className="notifications-token"
                      route="market"
                      params={{ address: item.tokenAddress }}
                      navigate={navigate}
                      aria-label={`View ${item.tokenName ?? "market"}`}
                    >
                      View market
                    </AppLink>
                  ) : null}
                </p>
                <time dateTime={item.createdAt}>
                  {formatRelativeTime(item.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="notifications-settings"
        aria-labelledby="notifications-settings-title"
        aria-busy={preferences.isPending || savePreferences.isPending}
      >
        <h2 id="notifications-settings-title">What you get told about</h2>
        {preferences.data ? (
          PREFERENCE_FIELDS.map((field) => (
            <label className="notifications-setting" key={field.key}>
              <span>
                <strong>{field.label}</strong>
                <small>{field.hint}</small>
              </span>
              <input
                type="checkbox"
                checked={preferences.data![field.key]}
                disabled={savePreferences.isPending}
                onChange={(event) => {
                  savePreferences.mutate({
                    ...preferences.data!,
                    [field.key]: event.target.checked,
                  });
                }}
              />
            </label>
          ))
        ) : (
          <p className="creator-data-status">
            Settings are unavailable right now.
          </p>
        )}
      </section>
    </main>
  );
}
