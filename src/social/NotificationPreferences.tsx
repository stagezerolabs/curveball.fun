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

const glyph = (path: string) => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;

const options = [
  ["trade_buys", "Buys", "From traders you follow", "buy", glyph("M5 15 15 5M7 5h8v8")],
  ["trade_sells", "Sells", "From traders you follow", "sell", glyph("M5 5l10 10M15 7v8H7")],
  ["graduations", "Milestones", "Curves at 25, 50, 70 and 100%", "milestone", glyph("M5 17V3.5M5 4h9l-2 3.5 2 3.5H5")],
] as const;

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
  return <section className="profile-settings-card" aria-labelledby="profile-notifications-title">
    <h2 id="profile-notifications-title">Notifications</h2>
    {preferences.isLoading ? <div className="settings-toggle-list" aria-busy="true" aria-label="Loading notification preferences">{options.map(([key]) => <span className="skeleton settings-toggle-skeleton" key={key} />)}</div>
      : preferences.isError || !preferences.data ? <div className="profile-notifications-error" role="alert"><span>Preferences are unavailable.</span><button type="button" onClick={() => void preferences.refetch()}>Retry</button></div>
        : <div className="settings-toggle-list">
          {options.map(([key, label, description, tone, glyph]) => <label className="settings-toggle-row" key={key}>
            <span className={`settings-icon ${tone}`} aria-hidden="true">{glyph}</span>
            <span className="settings-toggle-copy"><strong>{label}</strong><small>{description}</small></span>
            <input
              className="profile-switch"
              type="checkbox"
              role="switch"
              checked={preferences.data[key]}
              disabled={save.isPending}
              onChange={(event) => save.mutate({ ...preferences.data, [key]: event.target.checked })}
            />
          </label>)}
        </div>}
    {save.isError ? <p className="social-form-error" role="alert">{save.error.message}</p> : null}
  </section>;
}
