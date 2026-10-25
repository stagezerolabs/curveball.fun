import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { POST as uploadArtwork } from "../../api/artwork.js";

const port = Number(process.env.WEB_PORT || 8080);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("WEB_PORT must be a valid TCP port.");
}

const distRoot = resolve(
  fileURLToPath(new URL("../../dist/", import.meta.url)),
);
const indexFile = Bun.file(resolve(distRoot, "index.html"));

function forwardedUrl(request) {
  const incoming = new URL(request.url);
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    incoming.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    incoming.host;
  return `${proto}://${host}${incoming.pathname}${incoming.search}`;
}

function securityHeaders(headers = new Headers()) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  return headers;
}

function withSecurityHeaders(response) {
  const headers = securityHeaders(new Headers(response.headers));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function artworkRequest(request) {
  const normalized = new Request(forwardedUrl(request), request);
  return withSecurityHeaders(await uploadArtwork(normalized));
}

function safeAssetPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const path = resolve(distRoot, `.${decoded}`);
  if (path !== distRoot && !path.startsWith(`${distRoot}${sep}`)) return null;
  return path;
}

async function staticResponse(request) {
  const url = new URL(request.url);
  const assetPath = safeAssetPath(url.pathname);
  if (!assetPath) return new Response("Bad request", { status: 400 });

  const asset = Bun.file(assetPath);
  const hasExtension = /\.[^/]+$/.test(url.pathname);
  const file =
    url.pathname !== "/" && (await asset.exists())
      ? asset
      : hasExtension
        ? null
        : indexFile;
  if (!file || !(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  const headers = securityHeaders();
  headers.set(
    "Cache-Control",
    url.pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  );
  if (file.type) headers.set("Content-Type", file.type);
  return new Response(request.method === "HEAD" ? null : file, { headers });
}

const server = Bun.serve({
  hostname: "0.0.0.0",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return new Response("ok\n", {
        headers: securityHeaders(
          new Headers({
            "Cache-Control": "no-store",
            "Content-Type": "text/plain",
          }),
        ),
      });
    }
    if (url.pathname === "/api/artwork") return artworkRequest(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: securityHeaders(new Headers({ Allow: "GET, HEAD" })),
      });
    }
    return staticResponse(request);
  },
});

console.log(`Curveball web listening on :${server.port}`);
