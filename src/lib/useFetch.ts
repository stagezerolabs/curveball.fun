import { useEffect, useState } from "react";

/**
 * Minimal GET hook. A null url means "nothing to fetch yet" (e.g. waiting for a
 * wallet connection) and settles immediately rather than hanging on loading.
 */
export function useFetch<T>(url: string | null, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(url)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload: T) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, loading, error };
}
