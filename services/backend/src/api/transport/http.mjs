import { config } from "../../platform/config.mjs";
import { clientAddress } from "./clientAddress.mjs";

const JSON_LIMIT = 64 * 1024;

export function corsHeaders(request) {
  const origin = request.headers.origin;
  if (!origin || !config.allowedOrigins.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export function send(request, response, status, body, extraHeaders = {}) {
  console.log(
    `${request.method} ${request.url} -> ${status} origin=${request.headers.origin || "-"}`,
  );
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(request),
    ...extraHeaders,
  });
  response.end(payload);
  // Controllers return this value to signal that a route was handled.
  return true;
}

export async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT)
      throw Object.assign(new Error("Request body is too large."), {
        status: 413,
      });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), {
      status: 400,
    });
  }
}

export function openEventStream(request, response, hub) {
  response.writeHead(200, {
    ...corsHeaders(request),
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders?.();

  return hub.open(
    response,
    request.headers["last-event-id"],
    clientAddress(request, config.trustProxyClientIp),
  );
}
