export const routeTree = [
  { id: "home", path: "/", title: "Curveball — Fair token launches" },
  {
    id: "markets",
    path: "/markets",
    title: "Markets — Curveball",
    children: [
      { id: "market", path: "/markets/:address", title: "Market — Curveball" },
    ],
  },
  { id: "launch", path: "/launch", title: "Launch — Curveball" },
  { id: "notFound", path: "*", title: "Page not found — Curveball" },
];

const routes = routeTree.flatMap((route) => [route, ...(route.children || [])]);

function matchPath(pattern, pathname) {
  if (pattern === "*") return {};
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
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

export function resolveRoute(pathname) {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  for (const route of routes) {
    if (route.path === "*") continue;
    const params = matchPath(route.path, normalized);
    if (params) return { id: route.id, params, title: route.title };
  }
  const fallback = routes.find((route) => route.path === "*");
  return { id: fallback.id, params: {}, title: fallback.title };
}

export function routeHref(id, params = {}) {
  const route = routes.find((item) => item.id === id);
  if (!route || route.path === "*") throw Error(`Unknown route: ${id}`);
  return route.path.replace(/:([^/]+)/g, (_, key) => {
    if (params[key] === undefined) throw Error(`Missing route param: ${key}`);
    return encodeURIComponent(params[key]);
  });
}
