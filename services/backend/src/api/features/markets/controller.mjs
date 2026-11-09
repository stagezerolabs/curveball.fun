import { addressParam } from "../../transport/params.mjs";
import { send } from "../../transport/http.mjs";
import { markets, market, marketTape, marketTrades, marketCandles, marketHolders } from "./service.mjs";

export async function handleMarkets(request, response, url, viewer) {
  if (request.method === "GET" && url.pathname === "/v1/markets")
    return send(request, response, 200, await markets(url));
  const marketTradesMatch = url.pathname.match(
    /^\/v1\/markets\/(0x[a-fA-F0-9]{40})\/trades$/,
  );
  if (request.method === "GET" && marketTradesMatch) {
    return send(
      request,
      response,
      200,
      await marketTrades(url, addressParam(marketTradesMatch[1]), viewer),
    );
  }
  const marketCandlesMatch = url.pathname.match(
    /^\/v1\/markets\/(0x[a-fA-F0-9]{40})\/candles$/,
  );
  if (request.method === "GET" && marketCandlesMatch) {
    return send(
      request,
      response,
      200,
      await marketCandles(url, addressParam(marketCandlesMatch[1])),
    );
  }
  const marketHoldersMatch = url.pathname.match(
    /^\/v1\/markets\/(0x[a-fA-F0-9]{40})\/holders$/,
  );
  if (request.method === "GET" && marketHoldersMatch) {
    return send(
      request,
      response,
      200,
      await marketHolders(url, addressParam(marketHoldersMatch[1]), viewer),
    );
  }
  const marketTapeMatch = url.pathname.match(
    /^\/v1\/markets\/(0x[a-fA-F0-9]{40})\/tape$/,
  );
  if (request.method === "GET" && marketTapeMatch) {
    return send(
      request,
      response,
      200,
      await marketTape(addressParam(marketTapeMatch[1])),
    );
  }
  const marketMatch = url.pathname.match(
    /^\/v1\/markets\/(0x[a-fA-F0-9]{40})$/,
  );
  if (request.method === "GET" && marketMatch) {
    return send(
      request,
      response,
      200,
      await market(addressParam(marketMatch[1])),
    );
  }

  return false;
}
