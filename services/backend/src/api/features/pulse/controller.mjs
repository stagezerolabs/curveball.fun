import { send } from "../../transport/http.mjs";
import { pulse } from "./pulse.mjs";
import { followingActivity, leaderboards } from "./leaderboards.mjs";

export async function handlePulse(request, response, url, viewer) {
  if (request.method === "GET" && url.pathname === "/v1/pulse")
    return send(request, response, 200, await pulse(url, viewer));
  if (request.method === "GET" && url.pathname === "/v1/following/activity")
    return send(request, response, 200, await followingActivity(viewer));
  if (
    request.method === "GET" &&
    url.pathname.startsWith("/v1/leaderboards/")
  )
    return send(request, response, 200, await leaderboards(url, viewer));
  return false;
}
