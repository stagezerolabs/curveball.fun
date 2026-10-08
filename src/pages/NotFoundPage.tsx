import { AppLink } from "../components/Navigation";
import type { Navigate } from "../types";

export function NotFoundPage({ navigate }: { navigate: Navigate }) {
  return (
    <main className="page-status wrap">
      <h1>Page not found</h1>
      <AppLink className="primary-button" route="markets" navigate={navigate}>
        Browse markets
      </AppLink>
    </main>
  );
}
