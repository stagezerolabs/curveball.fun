import { send } from "../../transport/http.mjs";
import { protocolStats } from "./service.mjs";

export async function handleProtocol(request, response, url, viewer) {
  if (request.method === "GET" && url.pathname === "/v1/protocol/stats")
    return send(request, response, 200, await protocolStats());

  return false;
}
