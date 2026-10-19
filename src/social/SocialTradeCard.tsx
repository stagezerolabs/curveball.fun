import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { AppLink } from "../components/Navigation";
import { TokenAvatar } from "../components/TokenAvatar";
import { formatEthAmount, formatRelativeTime } from "../lib/format.js";
import { activeExplorerUrl } from "../lib/web3";
import type { Navigate, Token } from "../types";
import { TraderIdentity } from "./TraderIdentity";
import type { SocialTrade } from "./types";
import { socialApi } from "./api";
import { useSocialAuth } from "./useSocialAuth";
import { FollowButton } from "./FollowButton";

export function SocialTradeCard({ trade, navigate }: {
  trade: SocialTrade;
  navigate: Navigate;
}) {
  const { address } = useAccount();
  const { ensureAuthenticated } = useSocialAuth();
  const queryClient = useQueryClient();
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(trade.note ?? "");
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("spam");
  const [error, setError] = useState("");
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["social"] }), queryClient.invalidateQueries({ queryKey: ["markets", "trades"] })]);
  const saveNote = useMutation({ mutationFn: async () => { await ensureAuthenticated(); return socialApi.saveTradeNote(trade.id, note); }, onSuccess: async () => { setEditingNote(false); await refresh(); }, onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not save note.") });
  const reaction = useMutation({ mutationFn: async () => { await ensureAuthenticated(); return socialApi.reactToTrade(trade.id, !trade.reacted); }, onSuccess: refresh, onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not react.") });
  const report = useMutation({ mutationFn: async () => { await ensureAuthenticated(); return socialApi.report(trade.traderAddress, reason, "", trade.id); }, onSuccess: () => { setReporting(false); setError("Report submitted for review."); }, onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not report trade.") });
  const isOwner = address?.toLowerCase() === trade.traderAddress.toLowerCase();
  const quote = Number(formatEther(BigInt(trade.quoteAmountWei)));
  const tokenAmount = Number(formatEther(BigInt(trade.tokenAmountWei)));
  const activityToken: Token = {
    address: trade.tokenAddress,
    name: trade.tokenName,
    symbol: trade.tokenSymbol,
    creator: trade.traderAddress,
    graduated: false,
    createdAt: trade.blockTimestamp,
  };

  return (
    <article className="social-trade-card">
      <header>
        <TraderIdentity address={trade.traderAddress} displayName={trade.displayName} navigate={navigate} showAddress={false} />
        {!isOwner && trade.discoverable ? <FollowButton trader={trade.traderAddress} following={trade.isFollowed} onError={setError} /> : null}
        <time dateTime={trade.blockTimestamp} title={new Date(trade.blockTimestamp).toLocaleString()}>{formatRelativeTime(trade.blockTimestamp)}</time>
      </header>
      <div className="social-trade-body">
        <AppLink className="social-token-link" route="market" params={{ address: trade.tokenAddress }} navigate={navigate}>
          <TokenAvatar token={activityToken} className="social-token-avatar" />
          <span><strong>{trade.tokenName}</strong><small>${trade.tokenSymbol}</small></span>
        </AppLink>
        <div className="social-trade-statement">
          <span className={`social-side ${trade.isBuy ? "buy" : "sell"}`}>{trade.isBuy ? "Bought" : "Sold"}</span>
          <strong>{formatEthAmount(tokenAmount)} {trade.tokenSymbol}</strong>
          <span>for {formatEthAmount(quote)} WETH</span>
        </div>
      </div>
      {trade.note ? <p className="social-trade-note">{trade.note}</p> : null}
      {editingNote ? <form className="social-trade-form" onSubmit={(event) => { event.preventDefault(); saveNote.mutate(); }}><label htmlFor={`note-${trade.id}`}>Trade note</label><textarea id={`note-${trade.id}`} maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} /><div><button type="button" onClick={() => setEditingNote(false)}>Cancel</button><button type="submit" disabled={saveNote.isPending}>Save note</button></div></form> : null}
      {reporting ? <form className="social-trade-form" onSubmit={(event) => { event.preventDefault(); report.mutate(); }}><label htmlFor={`report-${trade.id}`}>Report this trade{trade.note ? " or note" : ""}</label><select id={`report-${trade.id}`} value={reason} onChange={(event) => setReason(event.target.value)}><option value="spam">Spam</option><option value="impersonation">Impersonation</option><option value="manipulation">Manipulation</option><option value="harmful_content">Harmful content</option><option value="other">Other</option></select><div><button type="button" onClick={() => setReporting(false)}>Cancel</button><button type="submit" disabled={report.isPending}>Submit report</button></div></form> : null}
      {error ? <p role="status" className="social-form-error">{error}</p> : null}
      <footer>
        <div className="social-trade-actions">
          <button type="button" aria-label={`${trade.reacted ? "Remove reaction from" : "React to"} trade, ${trade.reactionCount} reactions`} aria-pressed={trade.reacted} disabled={reaction.isPending} onClick={() => reaction.mutate()}>♥ {trade.reactionCount}</button>
          {isOwner ? <button type="button" onClick={() => { setNote(trade.note ?? ""); setEditingNote(true); }}> {trade.note ? "Edit note" : "Add note"}</button> : <button type="button" onClick={() => setReporting(true)}>Report trade</button>}
          <a href={`${activeExplorerUrl}/tx/${trade.transactionHash}`} target="_blank" rel="noreferrer">View transaction <span aria-hidden="true">↗</span></a>
          <AppLink route="market" params={{ address: trade.tokenAddress }} navigate={navigate} aria-label={`View ${trade.tokenName} market`}>View market</AppLink>
        </div>
      </footer>
    </article>
  );
}
