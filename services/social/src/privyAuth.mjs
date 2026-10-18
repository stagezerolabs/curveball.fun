import { getAddress, isAddress } from "viem";

export const ACTIVE_WALLET_HEADER = "x-curveball-wallet-address";

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function bearerToken(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function ethereumWallets(user) {
  return (user?.linked_accounts || []).filter((account) =>
    account?.type === "wallet"
    && account.chain_type === "ethereum"
    && typeof account.address === "string"
    && isAddress(account.address));
}

export function createPrivyAuthenticator({
  client,
  cacheTtlMs = 30_000,
  cacheMaxEntries = 5_000,
  now = Date.now,
}) {
  const userCache = new Map();

  async function userFor(userId) {
    const cached = userCache.get(userId);
    if (cached?.expiresAt > now()) {
      userCache.delete(userId);
      userCache.set(userId, cached);
      return cached.user;
    }

    userCache.delete(userId);
    const user = await client.users()._get(userId);

    if (userCache.size >= cacheMaxEntries) {
      userCache.delete(userCache.keys().next().value);
    }
    userCache.set(userId, { user, expiresAt: now() + cacheTtlMs });
    return user;
  }

  return async function authenticate(request) {
    const token = bearerToken(request);
    if (!token) return null;

    let claims;
    try {
      claims = await client.utils().auth().verifyAccessToken(token);
    } catch {
      throw httpError("Your Privy session is invalid or expired. Sign in again to continue.", 401);
    }

    const requestedAddress = request.headers[ACTIVE_WALLET_HEADER];
    if (typeof requestedAddress !== "string" || !isAddress(requestedAddress)) {
      throw httpError("Choose an Ethereum wallet in Privy to continue.", 401);
    }

    let user;
    try {
      user = await userFor(claims.user_id);
    } catch {
      throw httpError("Curveball could not confirm your Privy wallet. Try again.", 503);
    }

    const address = getAddress(requestedAddress).toLowerCase();
    const wallet = ethereumWallets(user).find((account) => account.address.toLowerCase() === address);
    if (!wallet) {
      throw httpError("This wallet is not linked to your Privy account.", 403);
    }

    return Object.freeze({ address, userId: claims.user_id, wallet });
  };
}
