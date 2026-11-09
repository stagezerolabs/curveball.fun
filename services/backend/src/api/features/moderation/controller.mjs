import { requireModerator } from "../../auth/auth.mjs";
import { readJson, send } from "../../transport/http.mjs";
import { moderation } from "./service.mjs";

export async function handleModeration(request, response, url) {
  if (request.method === "GET" && url.pathname === "/v1/admin/reports") {
    await requireModerator(request, false);
    return send(request, response, 200, await moderation.reports(url));
  }
  const reportMatch = url.pathname.match(/^\/v1\/admin\/reports\/(\d+)$/);
  if (request.method === "PATCH" && reportMatch) {
    await requireModerator(request);
    return send(request, response, 200, await moderation.updateReport(reportMatch[1], await readJson(request)));
  }
  return false;
}
