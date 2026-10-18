import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { socialApi } from "./api";
import { useSocialAuth } from "./useSocialAuth";

export function FollowButton({ trader, following, onError }: {
  trader: Address;
  following: boolean;
  onError?: (message: string) => void;
}) {
  const { address, ensureAuthenticated } = useSocialAuth();
  const queryClient = useQueryClient();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const shown = optimistic ?? following;
  const mutation = useMutation({
    mutationFn: async () => {
      await ensureAuthenticated();
      return socialApi.follow(trader, !shown);
    },
    onMutate: () => setOptimistic(!shown),
    onSuccess: async () => {
      setOptimistic(null);
      await queryClient.invalidateQueries({ queryKey: ["social"] });
    },
    onError: (error) => {
      setOptimistic(null);
      onError?.(error instanceof Error ? error.message : "Follow request failed.");
    },
  });

  if (address?.toLowerCase() === trader.toLowerCase()) return null;
  return (
    <button
      className={`social-follow-button${shown ? " following" : ""}`}
      type="button"
      aria-pressed={shown}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {mutation.isPending ? "Saving…" : shown ? "Following" : "Follow"}
    </button>
  );
}
