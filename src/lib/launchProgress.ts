export type LaunchPhase = "preparing" | "wrapWallet" | "wrapConfirming" | "approveWallet" | "approveConfirming" | "wallet" | "confirming" | "pending" | "success" | "error";

export function launchMilestone(phase: LaunchPhase | undefined): number {
  if (phase === "preparing") return 0;
  if (phase === "confirming") return 2;
  if (phase === "success") return 4;
  return 1;
}

export function formatLaunchElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}
