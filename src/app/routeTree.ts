type Route = {
  id: string;
  path: string;
  title: string;
};

const routes: Route[] = [
  { id: "landing", path: "/", title: "Curveball — Fair token launches" },
  { id: "markets", path: "/markets", title: "Markets — Curveball" },
  { id: "market", path: "/markets/:address", title: "Market — Curveball" },
  { id: "launch", path: "/launch", title: "Launch — Curveball" },
  { id: "profile", path: "/profile", title: "Your launches — Curveball" },
  { id: "notFound", path: "*", title: "Page not found — Curveball" },
];

export function canonicalPathname(pathname: string) {
  const legacyMarket = /^\/beta\/markets\/([^/]+)\/?$/.exec(pathname);
  if (legacyMarket) return `/markets/${legacyMarket[1]}`;
  return pathname === "/app" || pathname === "/app/" || pathname === "/beta" || pathname.startsWith("/beta/") ? "/markets" : pathname;
}

function matchPath(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  if (pattern === "*") return {};
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    if (patternPart.startsWith(":")) {
      try {
        params[patternPart.slice(1)] = decodeURIComponent(pathParts[index]);
      } catch {
        return null;
      }
    } else if (patternPart !== pathParts[index]) {
      return null;
    }
  }
  return params;
}

export function resolveRoute(pathname: string) {
  pathname = canonicalPathname(pathname);
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  for (const route of routes) {
    if (route.path === "*") continue;
    const params = matchPath(route.path, normalized);
    if (params) return { id: route.id, params, title: route.title };
  }
  const fallback = routes.find((route) => route.path === "*");
  if (!fallback) throw Error("Missing fallback route");
  return { id: fallback.id, params: {}, title: fallback.title };
}

export function routeHref(id: string, params: Record<string, string> = {}) {
  const route = routes.find((item) => item.id === id);
  if (!route || route.path === "*") throw Error(`Unknown route: ${id}`);
  return route.path.replace(/:([^/]+)/g, (_, key) => {
    if (params[key] === undefined) throw Error(`Missing route param: ${key}`);
    return encodeURIComponent(params[key]);
  });
}
