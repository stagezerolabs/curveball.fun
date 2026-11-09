import { stat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { POST as uploadArtwork } from "../../../../api/artwork.js";

const defaultDistRoot = fileURLToPath(new URL("../../../../dist/", import.meta.url));
const ARTWORK_BODY_LIMIT = 2_200_000;

function forwardedUrl(request) {
  const incoming = new URL(request.url, "http://localhost");
  const proto =
    request.headers["x-forwarded-proto"]?.split(",")[0]?.trim() || "http";
  const host =
    request.headers["x-forwarded-host"]?.split(",")[0]?.trim() ||
    request.headers.host ||
    "localhost";
  return `${proto}://${host}${incoming.pathname}${incoming.search}`;
}

function safeAssetPath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const path = resolve(root, `.${decoded}`);
  return path === root || path.startsWith(`${root}${sep}`) ? path : null;
}

async function regularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function registerWebRoutes(
  app,
  { distRoot = defaultDistRoot } = {},
) {
  const root = resolve(distRoot);
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    return payload;
  });

  app.addContentTypeParser(
    "multipart/form-data",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  app.all("/api/artwork", { bodyLimit: ARTWORK_BODY_LIMIT }, async (request, reply) => {
    const webRequest = new Request(forwardedUrl(request.raw), {
      method: request.method,
      headers: request.headers,
      body: request.method === "POST" ? request.body : undefined,
    });
    const response = await uploadArtwork(webRequest);
    reply.code(response.status);
    for (const [name, value] of response.headers) reply.header(name, value);
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });

  await app.register(fastifyStatic, { root, serve: false });

  app.get("/healthz", (_request, reply) =>
    reply.header("Cache-Control", "no-store").type("text/plain").send("ok\n"),
  );

  app.get("/*", async (request, reply) => {
    const pathname = new URL(request.raw.url, "http://localhost").pathname;
    if (pathname.startsWith("/api/") || pathname.startsWith("/v1/"))
      return reply.code(404).send({ error: "Endpoint not found." });
    const path = safeAssetPath(root, pathname);
    if (!path) return reply.code(400).send("Bad request");
    const isAsset = pathname !== "/" && (await regularFile(path));
    const hasExtension = /\.[^/]+$/.test(pathname);
    if (!isAsset && hasExtension) return reply.code(404).send("Not found");
    const selected = isAsset ? path : resolve(root, "index.html");
    if (!isAsset && !(await regularFile(selected)))
      return reply.code(404).send("Not found");
    reply.header(
      "Cache-Control",
      isAsset && pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    return reply.sendFile(relative(root, selected), { cacheControl: false });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.method !== "GET" && request.method !== "HEAD")
      return reply.code(405).header("Allow", "GET, HEAD").send("Method not allowed");
    return reply.code(404).send("Not found");
  });
}
