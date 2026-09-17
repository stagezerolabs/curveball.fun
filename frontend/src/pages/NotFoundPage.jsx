import { AppLink } from "../components/Navigation.jsx";

export function NotFoundPage({ navigate }) {
  return (
    <main className="page-status wrap">
      <h1>Page not found</h1>
      <AppLink className="primary-button" route="home" navigate={navigate}>
        Go home
      </AppLink>
    </main>
  );
}
