# Trader identity is the wallet and its RNS name

A Curveball trader has no editable profile. Names resolve to the wallet's RISE `.rise` primary name, and to the truncated wallet address when there isn't one. The `profiles` table records only that a wallet signed in, so the app can tell a Curveball trader from an anonymous counterparty; it stores no display name, no bio, and no visibility setting. Every wallet's activity is visible to everyone.

The product wedge for the MVP is the follow graph: follow a wallet, then see the tokens that wallet created, bought, or sold in Pulse, and get told when it happens. Nothing in that loop needs text a user types, and the names it does need already exist on-chain in RNS. Letting users invent display names would put them beside RNS names that mean the same thing, would need moderation for impersonation and harmful content, and would need a visibility model to be honest about. The 2026-10-18 security review found exactly that gap: `discoverable` gated the leaderboard but not the profile or feed reads that return the same name (`docs/audits/dreadnode-2026-10-18/`), so a wallet could opt out of one surface and still be exposed on two others. Deleting the fields removes the question instead of answering it badly.

Decisions and the trust assumptions they leave:

- **Naming.** RNS primary name, else address. No claimed handle, so no name collisions, no impersonation vector, and no name squatting to moderate.
- **RNS is the identity authority.** A trader can rename themselves outside Curveball and the app follows the new name. Resolution is cached (`rns_cache`, ten minutes) and re-checked on every read that shows a name.
- **No discovery privacy.** There is no opt-out of the leaderboards, no hidden profile, and no way to stop appearing in someone else's feed. Blocking is still honoured: it removes the other wallet from both sides' social reads, it does not hide history.
- **Leaderboards rank every wallet** that meets the published methodology, whether or not it has ever signed in. Before this change a wallet had to claim a profile and opt in, which is why the boards were near-empty.
- **Claiming is still real.** Signing in with a verified Privy wallet inserts the profile row. It marks the wallet as a known Curveball trader and is what makes follows, notes, and reactions possible; it grants no display fields.
- **Reports stay.** Moderation exists for trading behaviour and impersonation via RNS, not for profile text there no longer is.
- **Revisit before public launch.** Visibility per surface, and any user-authored fields, come back with the moderation and privacy work that has to accompany them. Address-only identity is defensible for a testnet-scale audience and not for an open mainnet one.
