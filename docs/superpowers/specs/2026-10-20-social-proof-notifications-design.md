# Social proof, follows, and notifications across the app

Date: 2026-10-20
Branch: `feature/pulse-signal-desk`

## Goal

Move social out of the Pulse tab and into the surfaces people already use, finish the follow loop
(follow a wallet, see and get told about the tokens it creates, buys, and sells), and remove the
identity fields that were neither editable in the UI nor honest about visibility.

## Identity: RNS name or wallet address

Per [ADR 0004](../../adr/0004-rns-only-trader-identity.md):

- `profiles` keeps only `chain_id`, `address`, `claimed_at`, `updated_at`. `display_name`, `bio`, and
  `discoverable` are dropped (migration `0007`), along with the name/bio checks and the discoverable
  index.
- `POST /v1/profiles/me` is gone. Claiming still happens on first verified sign-in (`POST /v1/me`),
  and a claim writes nothing but the row itself.
- No leaderboard read or write filters on discoverability, so every wallet with a current-method
  snapshot can rank. Follows, blocks, notes, reactions, reports, and the moderation queue are unchanged.
- `useTraderName` (`src/social/TraderIdentity.tsx`) is the single resolution path: RNS primary name,
  else `0x1234…abcd`. `TraderIdentity` (avatar + name + address), `TraderName` (inline link), and the
  header wallet pill all use it, so no surface can invent a fourth naming rule.

## Following: created, bought, sold

`followingActivitySql` replaces `followingBuysSql`, served by `GET /v1/following/activity`:

- One row per market a followed wallet touched, with an `actors` array of `{address, action,
amountQuoteWei}` aggregated per wallet **and** action, `boughtQuoteWei`, `soldQuoteWei`, `latestAt`.
  Ordered by most recent activity, then actor count, capped at 12.
- Actions are `launch` (from `markets.creator_address`), `buy`, and `sell`. Protocol accounts and
  viewer-blocked wallets are excluded, as before.
- The read has **no "every wallet" mode**. `GET /v1/following/activity` requires an authenticated
  viewer (401 otherwise, like `scope=following` on Pulse and the feed) and returns
  `{ scope: "following", followedCount, items }`. A signed-in viewer who follows nobody gets an empty
  list plus `followedCount: 0`, which the UI renders as "You are not following anyone yet" with a
  route into Explore. Listing strangers under a tab called Following was reviewed and rejected: it
  reads as "the app follows everyone" and hides the fact that the viewer's graph is empty.
- The only all-wallets view left is the browser fallback used when no social API is configured at
  all (`buildFollowingActivity` with no followed wallets), and it is labelled as that, not as follows.
- Explore's "N follows active here" badge is driven only by `scope === "following"` results.

## Market surfaces

- `GET /v1/markets/:token/trades` is now viewer-aware. Each row carries `note`, `reactionCount`,
  `reacted`, `isFollowed`, and `followerCount`, and the response carries `followingTraderCount`:
  distinct wallets the viewer follows that traded that market. Blocked wallets drop out of the rows.
- `GET /v1/markets/:token/holders` is viewer-aware too: `isFollowed` per holder and
  `followedHolderCount`, with blocked wallets still counted in `eligibleSupply` because they are real
  holders of the market even when hidden from one viewer's social reads.
- Trade history (`MarketActivity`) links each trader to their profile, tags rows from followed
  wallets, shows the note, and gives every indexed row a Conviction toggle.
- The About panel renders the creator as a trader (`TraderIdentity`, follower count, FollowButton)
  instead of an explorer link.
- Top holders (`CreatorTokenInsights`) read the indexed holder endpoint when the backend is
  configured, so holders are named and followable; the full on-chain transfer scan remains the
  no-backend fallback.
- Explore cards show "N follows active here" from the same Following read, so no new query is needed.
- Trader profiles show the trader's launches to visitors (`fetchCreatorMarkets`), and their activity
  rows surface notes and Conviction counts.

## Notifications

- New kind `followed_launch`; new preference `launches` (migration `0008`). A launch notifies the
  creator's followers, gated by `in_app` and `launches`, alongside the existing `launch` outbox event.
- Conviction now notifies the trade's author (`reaction`, deduplicated per reactor and trade, skipped
  when the author reacts to their own trade, gated by `in_app`).
- `GET /v1/notifications` serves every kind instead of three, returns `unreadCount`, and accepts
  `?kind=` filters. `GET`/`PATCH /v1/notification-preferences` cover all six toggles.
- The app gets a bell in both headers (unread badge), `/notifications` (inbox, mark-read, per-kind
  settings), and `useSocialStream`: one `EventSource` on `GET /v1/events` that throttles invalidation
  to feeds (10s) and the inbox (30s). Per-query intervals remain as the backstop if the stream drops.

## Testing

- `services/social`: `followingActivitySql` is asserted to include the launch branch and the follow
  filter; existing Pulse, performance, milestones, outbox, and Privy tests still pass.
- `src/social/followingActivity.test.ts`: fallback aggregation, launch/buy/sell mixing, per-wallet
  totals, no-follows fallback, and followed-wallet narrowing.
- Run read-only against the preview stack: `/v1/following/activity`, `/v1/markets/:token/trades`,
  `/v1/markets/:token/holders`, `/v1/profiles/:address`, `/v1/leaderboards/consistent`, and the
  notification reads and launch fan-out inside a rolled-back transaction.

## Follow-up

- The Dreadnode finding about `discoverable` not being enforced on profile and feed reads is moot for
  now: there is no discoverability to enforce. Revisit with visibility controls once the product is
  public, together with any user-authored fields.
- Curve milestone notifications are still gated by the `graduations` preference rather than their own.
