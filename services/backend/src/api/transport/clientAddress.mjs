import { isIP } from "node:net";

/** The edge overwrites this header; only use it when the API is on a private network. */
export function clientAddress(request, trustProxyClientIp = false) {
  const forwarded = request.headers["x-curveball-client-ip"];
  if (trustProxyClientIp && typeof forwarded === "string" && isIP(forwarded))
    return forwarded;
  return request.socket.remoteAddress || "unknown";
}
