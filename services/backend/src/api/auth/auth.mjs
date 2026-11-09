import { PrivyClient } from "@privy-io/node";
import { config } from "../../platform/config.mjs";
import { createPrivyAuthenticator } from "./privyAuth.mjs";

const privyClient = new PrivyClient({
  appId: config.privyAppId,
  appSecret: config.privyAppSecret,
});
const authenticatePrivyRequest = createPrivyAuthenticator({
  client: privyClient,
});
const requestAuthentication = new WeakMap();

export function requireOrigin(request) {
  const origin = request.headers.origin;
  if (!origin || !config.allowedOrigins.has(origin)) {
    throw Object.assign(new Error("Request origin is not allowed."), {
      status: 403,
    });
  }
}

export function authenticationFor(request) {
  let authentication = requestAuthentication.get(request);
  if (!authentication) {
    authentication = authenticatePrivyRequest(request);
    requestAuthentication.set(request, authentication);
  }
  return authentication;
}

export async function viewerFor(request) {
  try {
    return (await authenticationFor(request))?.address || null;
  } catch {
    return null;
  }
}

export async function requirePrivyWallet(request, checkOrigin = true) {
  if (checkOrigin) requireOrigin(request);
  const authentication = await authenticationFor(request);
  if (!authentication)
    throw Object.assign(new Error("Sign in with Privy to continue."), {
      status: 401,
    });
  return authentication.address;
}

export async function requireModerator(request, checkOrigin = true) {
  const address = await requirePrivyWallet(request, checkOrigin);
  if (address !== config.adminAddress)
    throw Object.assign(new Error("Moderator access is required."), {
      status: 403,
    });
  return address;
}
