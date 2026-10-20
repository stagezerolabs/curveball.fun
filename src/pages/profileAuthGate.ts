// Decides which view /profile should render while authentication settles.
//
// The bug this guards: the page used to show the sign-in screen whenever wagmi's
// `address` was missing, so a refresh flashed a login page and offered "Create
// account or sign in" while Privy's session was restoring — calling login() on
// an already-authenticated account (the "already logged in" wallet warning).
export type ProfileAuthView = "loading" | "restoring" | "login" | "ready";

export function selectProfileAuthView({ ready, authenticated, hasAddress }: {
  ready: boolean;
  authenticated: boolean;
  hasAddress: boolean;
}): ProfileAuthView {
  if (!ready) return "loading";
  if (authenticated && !hasAddress) return "restoring";
  if (!authenticated || !hasAddress) return "login";
  return "ready";
}
