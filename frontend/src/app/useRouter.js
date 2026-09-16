import { useEffect, useState } from "react";
import { resolveRoute, routeHref } from "./routeTree.js";

export function useRouter() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const route = resolveRoute(pathname);

  useEffect(() => {
    document.title = route.title;
  }, [route.title]);

  function navigate(id, params) {
    const next = routeHref(id, params);
    if (next === window.location.pathname) return;
    window.history.pushState({}, "", next);
    setPathname(next);
    window.scrollTo({ top: 0 });
  }

  return { navigate, route };
}
