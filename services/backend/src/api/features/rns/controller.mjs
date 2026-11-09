import { config } from "../../../platform/config.mjs";
import { clientAddress } from "../../transport/clientAddress.mjs";
import { addressParam } from "../../transport/params.mjs";
import { send } from "../../transport/http.mjs";
import { resolveRns } from "./service.mjs";

export async function handleRns(request, response, url, viewer) {
  const rnsMatch = url.pathname.match(
    /^\/v1\/rns\/primary\/(0x[a-fA-F0-9]{40})$/,
  );
  if (request.method === "GET" && rnsMatch) {
    const address = addressParam(rnsMatch[1]);
    return send(
      request,
      response,
      200,
      await resolveRns(
        address,
        clientAddress(request, config.trustProxyClientIp),
      ),
    );
  }
  return false;
}
