import Fastify from "fastify";
import { pool } from "../platform/db.mjs";
import { config } from "../platform/config.mjs";
import { ACTIVE_WALLET_HEADER } from "./auth/privyAuth.mjs";
import { viewerFor } from "./auth/auth.mjs";
import { corsHeaders, openEventStream, send } from "./transport/http.mjs";
import { captureBackendException } from "../platform/instrument.mjs";
import { createOutboxHub } from "./events/outboxHub.mjs";
import { handleRns } from "./features/rns/controller.mjs";
import { handlePulse } from "./features/pulse/controller.mjs";
import { handleMarkets } from "./features/markets/controller.mjs";
import { handleProtocol } from "./features/protocol/controller.mjs";
import { handleSocial } from "./features/social/controller.mjs";
import { handleModeration } from "./features/moderation/controller.mjs";
import { handleNotifications } from "./features/notifications/controller.mjs";

export function registerSocialRoutes(app, { subscribe } = {}) {
  const eventHub = createOutboxHub({
    query: (...args) => pool.query(...args),
    subscribe,
  });
  app.decorate("closeEventStreams", () => eventHub.close());

  async function dispatch(request, response) {
    const url = new URL(request.url || "/", config.publicOrigin);
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          ...corsHeaders(request),
          "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": `Content-Type, Authorization, ${ACTIVE_WALLET_HEADER}`,
        });
        return response.end();
      }
      if (request.method === "GET" && url.pathname === "/health") {
        const result = await pool.query(
          "SELECT stream, next_block, updated_at FROM chain_cursors WHERE chain_id=$1",
          [config.chainId],
        );
        return send(request, response, 200, {
          ok: true,
          chainId: config.chainId,
          cursors: result.rows,
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/events") {
        await openEventStream(request, response, eventHub);
        return;
      }

      const viewer = await viewerFor(request);
      if (await handleRns(request, response, url, viewer)) return;
      if (await handleSocial(request, response, url, viewer)) return;
      if (await handlePulse(request, response, url, viewer)) return;
      if (await handleMarkets(request, response, url, viewer)) return;
      if (await handleProtocol(request, response, url, viewer)) return;
      if (await handleModeration(request, response, url)) return;
      if (await handleNotifications(request, response, url)) return;
      return send(request, response, 404, { error: "Endpoint not found." });
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) {
        captureBackendException(error, "api");
        console.error(error);
      }
      if (response.headersSent) return response.end();
      return send(
        request,
        response,
        status,
        {
          error:
            status >= 500
              ? "The social service could not complete this request."
              : error.message,
        },
        error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {},
      );
    }
  }

  // The existing controllers consume Node request streams and own their responses.
  // Hijack before Fastify parses a body so their size limits, auth, and SSE behavior
  // stay intact while both applications move to one Fastify listener.
  const bridge = {
    onRequest: async (request, reply) => {
      reply.hijack();
      await dispatch(request.raw, reply.raw);
      return reply;
    },
  };
  app.all("/v1/*", bridge, () => {});
  app.all("/health", bridge, () => {});
}

export function createSocialServer(options) {
  const app = Fastify({ logger: false });
  registerSocialRoutes(app, options);
  return app;
}
