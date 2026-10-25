import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { socialApi } from "./api";
import { useSocialAuth } from "./useSocialAuth";

export function FollowButton({
  trader,
  following,
  onError,
}: {
  trader: Address;
  following: boolean;
  onError?: (message: string) => void;
}) {
  const { address, ensureAuthenticated } = useSocialAuth();
  const queryClient = useQueryClient();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const shown = optimistic ?? following;
  const mutation = useMutation({
    mutationFn: async ({ shouldFollow }: { shouldFollow: boolean }) => {
      await ensureAuthenticated();
      return socialApi.follow(trader, shouldFollow);
    },
    onMutate: ({ shouldFollow }) => setOptimistic(shouldFollow),
    onSuccess: async () => {
      setOptimistic(null);
      await queryClient.invalidateQueries({ queryKey: ["social"] });
      // Trader rows show a Following tag, so market activity has to re-read its follow flags.
      await queryClient.invalidateQueries({ queryKey: ["markets", "trades"] });
    },
    onError: (error) => {
      setOptimistic(null);
      onError?.(
        error instanceof Error ? error.message : "Follow request failed.",
      );
    },
  });

  if (address?.toLowerCase() === trader.toLowerCase()) return null;
  return (
    <button
      className={`social-follow-button${shown ? " following" : ""}`}
      type="button"
      aria-pressed={shown}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate({ shouldFollow: !shown })}
    >
      {mutation.isPending ? "Saving…" : shown ? "Following" : "Follow"}
    </button>
  );
}
