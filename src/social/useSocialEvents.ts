import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { socialApiBaseUrl, socialApiConfigured } from "./api";

/** Events signal that canonical reads changed; event payloads never replace API data. */
export function useSocialEvents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!socialApiConfigured) return;
    const events = new EventSource(`${socialApiBaseUrl}/v1/events`);
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["social"] });
      void queryClient.invalidateQueries({ queryKey: ["markets", "trades"] });
    };
    events.addEventListener("ready", refresh);
    events.addEventListener("social_update", refresh);
    events.addEventListener("trade", refresh);
    events.addEventListener("graduation", refresh);
    events.addEventListener("market_update", refresh);
    events.addEventListener("stream_error", refresh);
    return () => events.close();
  }, [queryClient]);
}
