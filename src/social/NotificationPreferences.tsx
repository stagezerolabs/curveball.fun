import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { socialApi, socialApiConfigured } from "./api";
import { useSocialAuth } from "./useSocialAuth";

type Preferences = {
  in_app: boolean;
  trade_buys: boolean;
  trade_sells: boolean;
  graduations: boolean;
};

export function NotificationPreferences({ address }: { address: Address }) {
  const { ensureAuthenticated } = useSocialAuth();
  const queryClient = useQueryClient();
  const preferences = useQuery({
    queryKey: ["social", "notification-preferences", address.toLowerCase()],
    queryFn: () => socialApi.notificationPreferences(),
    enabled: socialApiConfigured,
    retry: false,
  });
  const save = useMutation({
    mutationFn: async (next: Preferences) => {
      await ensureAuthenticated();
      return socialApi.saveNotificationPreferences({
        inApp: next.in_app,
        tradeBuys: next.trade_buys,
        tradeSells: next.trade_sells,
        graduations: next.graduations,
      });
    },
    onSuccess: (next) => queryClient.setQueryData(["social", "notification-preferences", address.toLowerCase()], next),
  });

  if (!socialApiConfigured) return null;
  return <section className="profile-notification-preferences" aria-labelledby="profile-notifications-title">
    <header><div><p>Preferences</p><h2 id="profile-notifications-title">Notifications</h2></div><span>In app</span></header>
    <p>Choose what appears under the notification bell.</p>
    {preferences.isLoading ? <div className="profile-notifications-loading skeleton" aria-label="Loading notification preferences" />
      : preferences.isError || !preferences.data ? <div className="profile-notifications-error" role="alert"><span>Preferences are unavailable.</span><button type="button" onClick={() => void preferences.refetch()}>Retry</button></div>
        : <div className="profile-notification-options">
          {([
            ["trade_buys", "Followed trader buys", "When someone you follow buys on Curveball."],
            ["trade_sells", "Followed trader sells", "When someone you follow sells on Curveball."],
            ["graduations", "Curve milestones", "25%, 50%, 70%, and 100% for your launches and launches from traders you follow."],
          ] as const).map(([key, label, description]) => <label key={key}>
            <span><strong>{label}</strong><small>{description}</small></span>
            <input
              type="checkbox"
              checked={preferences.data[key]}
              disabled={save.isPending}
              onChange={(event) => save.mutate({ ...preferences.data, [key]: event.target.checked })}
            />
          </label>)}
        </div>}
    {save.isError ? <p className="social-form-error" role="alert">{save.error.message}</p> : null}
  </section>;
}
