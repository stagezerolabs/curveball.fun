import { pool } from "../../../platform/db.mjs";
import { config } from "../../../platform/config.mjs";
import { addressParam } from "../../transport/params.mjs";
import { claimProfile } from "./profiles.mjs";
import { feed } from "./feed.mjs";
import { profile } from "./profile.mjs";
import { requirePrivyWallet } from "../../auth/auth.mjs";
import { readJson, send } from "../../transport/http.mjs";
import { limitSocialWrite } from "../../transport/rateLimit.mjs";
import { socialActions } from "./actions.mjs";

export async function handleSocial(request, response, url, viewer) {
  if (request.method === "GET" && url.pathname === "/v1/me")
    return send(request, response, 200, { address: viewer });
  if (request.method === "POST" && url.pathname === "/v1/me") {
    const address = await requirePrivyWallet(request);
    await claimProfile(pool, config.chainId, address);
    return send(request, response, 200, { address });
  }
  if (request.method === "GET" && url.pathname === "/v1/feed")
    return send(request, response, 200, await feed(url, viewer));
  const profileMatch = url.pathname.match(
    /^\/v1\/profiles\/(0x[a-fA-F0-9]{40})$/,
  );
  if (request.method === "GET" && profileMatch) {
    const address = addressParam(profileMatch[1]);
    return send(request, response, 200, await profile(address, viewer));
  }


  const followMatch = url.pathname.match(/^\/v1\/follows\/(0x[a-fA-F0-9]{40})$/);
  if (followMatch && ["POST", "DELETE"].includes(request.method)) {
    const address = await requirePrivyWallet(request);
    limitSocialWrite(request, address);
    return send(request, response, 200, await socialActions.setFollow(address, followMatch[1], request.method === "POST"));
  }

  const blockMatch = url.pathname.match(/^\/v1\/blocks\/(0x[a-fA-F0-9]{40})$/);
  if (blockMatch && ["POST", "DELETE"].includes(request.method)) {
    const address = await requirePrivyWallet(request);
    limitSocialWrite(request, address);
    return send(request, response, 200, await socialActions.setBlock(address, blockMatch[1], request.method === "POST"));
  }

  if (request.method === "POST" && url.pathname === "/v1/reports") {
    const address = await requirePrivyWallet(request);
    limitSocialWrite(request, address);
    return send(request, response, 201, await socialActions.report(address, await readJson(request)));
  }

  if (request.method === "POST" && url.pathname === "/v1/trade-notes") {
    const address = await requirePrivyWallet(request);
    limitSocialWrite(request, address);
    return send(request, response, 200, await socialActions.setTradeNote(address, await readJson(request)));
  }

  if (request.method === "POST" && url.pathname === "/v1/trade-reactions") {
    const address = await requirePrivyWallet(request);
    limitSocialWrite(request, address);
    return send(request, response, 200, await socialActions.setTradeReaction(address, await readJson(request)));
  }
  return false;
}
