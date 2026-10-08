import { useEffect, useState } from "react";
import { canonicalPathname, resolveRoute, routeHref } from "./routeTree";

export function useRouter() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const sync = () => {
      const next = canonicalPathname(window.location.pathname);
      if (next !== window.location.pathname) {
        window.history.replaceState(
          window.history.state,
          "",
          `${next}${window.location.search}${window.location.hash}`,
        );
      }
      setPathname(next);
    };
    sync();
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
