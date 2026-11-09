import { requirePrivyWallet } from "../../auth/auth.mjs";
import { readJson, send } from "../../transport/http.mjs";
import { limitSocialWrite } from "../../transport/rateLimit.mjs";
import { notifications } from "./service.mjs";

export async function handleNotifications(request, response, url) {
  if (request.method === "GET" && url.pathname === "/v1/notifications") {
    const address = await requirePrivyWallet(request, false);
    return send(request, response, 200, await notifications.list(address, url));
  }
  if (request.method === "GET" && url.pathname === "/v1/notification-preferences") {
    const address = await requirePrivyWallet(request, false);
    return send(request, response, 200, await notifications.preferences(address));
  }
  if (request.method === "PATCH" && url.pathname === "/v1/notification-preferences") {
    const address = await requirePrivyWallet(request);
    limitSocialWrite(request, address);
    return send(request, response, 200, await notifications.updatePreferences(address, await readJson(request)));
  }
  if (request.method === "PATCH" && url.pathname === "/v1/notifications/read") {
    const address = await requirePrivyWallet(request);
    limitSocialWrite(request, address);
    return send(request, response, 200, await notifications.markRead(address, await readJson(request)));
  }
  return false;
}
