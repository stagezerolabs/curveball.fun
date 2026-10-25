import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSwitchChain } from "wagmi";
import {
  readContract,
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import {
  formatEther,
  formatUnits,
  parseEther,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import {
  feePercentToBps,
  readFactoryFunds,
  readFeeDefaults,
  submitFeeUpdate,
  type FactoryFunds,
  type FeeAuthority,
} from "../lib/adminFees";
import { isAdminAddress } from "../lib/adminAccess";
import { readableError } from "../lib/errors";
import { formatAddress } from "../lib/format.js";
import {
  activeChainId,
  activeExplorerUrl,
  launchpadAddress,
  wagmiConfig,
} from "../lib/web3";
import { curveLaunchpadAbi } from "../sdk/contracts";
import { socialApi, socialApiConfigured } from "../social/api";
import type { ModerationReport } from "../social/types";
import { useSocialAuth } from "../social/useSocialAuth";

type Settings = FeeAuthority;

function displayBalance(balance: bigint, decimals: number): string {
  const [whole, fraction = ""] = formatUnits(balance, decimals).split(".");
  const visibleFraction = fraction.slice(0, 6).replace(/0+$/, "");
  if (balance > 0n && whole === "0" && !visibleFraction) return "<0.000001";
  return visibleFraction ? `${whole}.${visibleFraction}` : whole;
}

function ExplorerAddress({
  address,
  label,
}: {
  address: Address;
  label: string;
}) {
  return (
    <a
      href={`${activeExplorerUrl}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      title={address}
      aria-label={`${label}: ${address}. View on explorer`}
    >
      {formatAddress(address)} <span aria-hidden="true">↗</span>
    </a>
  );
}

function FundsPanel({ funds }: { funds: FactoryFunds }) {
  return (
    <section
      className="admin-panel admin-funds-summary"
      aria-labelledby="admin-funds-title"
    >
      <div className="admin-side-head">
        <h2 id="admin-funds-title">Protocol funds</h2>
        <span>{funds.symbol}</span>
      </div>
      <dl className="admin-funds-grid">
        {[
          { label: "Treasury wallet", fund: funds.treasuryWallet },
          { label: "Treasury fees in escrow", fund: funds.treasuryInEscrow },
          { label: "Escrow total (fees and buybacks)", fund: funds.escrowHeld },
        ].map(({ label, fund }) => (
          <div key={label} className="admin-fund-row">
            <dt>{label}</dt>
            <dd>
              <strong>
                {displayBalance(fund.balance, funds.decimals)}{" "}
                <span>{funds.symbol}</span>
              </strong>
              <ExplorerAddress address={fund.address} label={label} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function FactoryDetails({
  settings,
  factory,
}: {
  settings: Settings;
  factory: Address;
}) {
  return (
    <aside
      className="admin-panel admin-details"
      aria-labelledby="admin-details-title"
    >
      <h2 id="admin-details-title">Launchpad details</h2>
      <dl>
        <div>
          <dt>Launchpad</dt>
          <dd>
            <ExplorerAddress address={factory} label="Launchpad" />
          </dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>
            <ExplorerAddress address={settings.owner} label="Owner" />
          </dd>
        </div>
        {settings.pendingOwner !== zeroAddress && (
          <div>
            <dt>Pending owner</dt>
            <dd>
              <ExplorerAddress
                address={settings.pendingOwner}
                label="Pending owner"
              />
            </dd>
          </div>
        )}
        <div>
          <dt>Creator share</dt>
          <dd>{(settings.creatorShareBps / 100).toFixed(2)}%</dd>
        </div>
        <div>
          <dt>Buyback share</dt>
          <dd>{(settings.buybackShareBps / 100).toFixed(2)}%</dd>
        </div>
        <div>
          <dt>Creator tax cap</dt>
          <dd>{(settings.creatorTaxCapBps / 100).toFixed(2)}%</dd>
        </div>
        <div>
          <dt>Guardian</dt>
          <dd>
            <ExplorerAddress address={settings.guardian} label="Guardian" />
          </dd>
        </div>
        <div>
          <dt>Treasury</dt>
          <dd>
            <ExplorerAddress address={settings.treasury} label="Treasury" />
          </dd>
        </div>
      </dl>
    </aside>
  );
}

function ModerationRow({
  report,
  pending,
  onUpdate,
}: {
  report: ModerationReport;
  pending: boolean;
  onUpdate: (
    id: string,
    status: "reviewing" | "actioned" | "dismissed",
    note: string,
  ) => void;
}) {
  const [note, setNote] = useState(report.resolution_note ?? "");
  return (
    <li>
      <header>
        <span className={`report-status ${report.status}`}>
          {report.status}
        </span>
        <time dateTime={report.created_at}>
          {new Date(report.created_at).toLocaleString()}
        </time>
      </header>
      <p>
        <strong>{report.reason.replace("_", " ")}</strong> against{" "}
        <a
          href={`${activeExplorerUrl}/address/${report.subject_address}`}
          target="_blank"
          rel="noreferrer"
        >
          {formatAddress(report.subject_address)} ↗
        </a>
      </p>
      {report.details ? <blockquote>{report.details}</blockquote> : null}
      <label>
        Resolution note
        <textarea
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="admin-actions">
        <button
          type="button"
          disabled={pending}
          onClick={() => onUpdate(report.id, "reviewing", note)}
        >
          Reviewing
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onUpdate(report.id, "actioned", note)}
        >
          Actioned
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onUpdate(report.id, "dismissed", note)}
        >
          Dismiss
        </button>
      </div>
    </li>
  );
}

export function AdminPage() {
  const feeInputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const focusInputAfterSave = useRef(false);
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [funds, setFunds] = useState<FactoryFunds | null>(null);
  const [draft, setDraft] = useState("");
  const [reviewBps, setReviewBps] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [message, setMessage] = useState("");
  const [hash, setHash] = useState<Hash | null>(null);
  const [target, setTarget] = useState<bigint | null>(null);
  const [targetDraft, setTargetDraft] = useState("");
  const [targetReview, setTargetReview] = useState<bigint | null>(null);
  const [targetError, setTargetError] = useState("");
  const configured = Boolean(launchpadAddress);
  const isAdmin = isAdminAddress(address);
  const correctChain = chainId === activeChainId;
  const { ensureAuthenticated } = useSocialAuth();
  const queryClient = useQueryClient();
  const moderation = useQuery({
    queryKey: ["social", "admin", "reports"],
    queryFn: () => socialApi.moderationReports("open"),
    enabled: Boolean(isAdmin && socialApiConfigured),
    retry: false,
  });
  const updateReport = useMutation({
    mutationFn: async ({
      id,
      status,
      note,
    }: {
      id: string;
      status: "reviewing" | "actioned" | "dismissed";
      note: string;
    }) => {
      await ensureAuthenticated();
      return socialApi.updateModerationReport(id, status, note);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["social", "admin", "reports"],
      }),
  });

  const refresh = useCallback(
    async (resetDraft = false) => {
      if (!configured || !launchpadAddress) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [latest, latestFunds] = await Promise.all([
          readFeeDefaults(wagmiConfig, launchpadAddress, activeChainId),
          readFactoryFunds(wagmiConfig, launchpadAddress, activeChainId),
        ]);
        setSettings(latest);
        setFunds(latestFunds);
        if (resetDraft) setDraft((latest.feeBps / 100).toFixed(2));
        const nextTarget = await readContract(wagmiConfig, {
          address: launchpadAddress,
          abi: curveLaunchpadAbi,
          functionName: "graduationTarget",
          chainId: activeChainId,
        });
        setTarget(nextTarget);
        if (resetDraft) setTargetDraft(formatEther(nextTarget));
        setError("");
      } catch (cause) {
        setError(
          readableError(
            cause,
            "Could not read launchpad settings or balances.",
          ),
        );
      } finally {
        setLoading(false);
      }
    },
    [configured],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);
  useEffect(() => {
    if (reviewBps !== null) confirmRef.current?.focus();
  }, [reviewBps]);
  useEffect(() => {
    if (!pending && focusInputAfterSave.current) {
      focusInputAfterSave.current = false;
      feeInputRef.current?.focus();
    }
  }, [pending]);

  const onReview = (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    try {
      const next = feePercentToBps(draft);
      if (next === settings.feeBps)
        throw new Error("The fee is already set to this value.");
      setReviewBps(next);
      setError("");
      setFieldError("");
      setMessage("");
    } catch (cause) {
      setFieldError(readableError(cause));
    }
  };

  const run = async () => {
    if (!launchpadAddress || pending) return;
    setPending(true);
    setHash(null);
    setError("");
    setMessage("Confirm the fee update in your wallet.");
    try {
      const tx = await submitFeeUpdate(
        wagmiConfig,
        launchpadAddress,
        activeChainId,
        reviewBps!,
        setHash,
      );
      setHash(tx);
      setReviewBps(null);
      await refresh(true);
      setMessage("Fee update confirmed on-chain.");
      focusInputAfterSave.current = true;
    } catch (cause) {
      setError(readableError(cause, "Transaction failed."));
      setMessage("");
    } finally {
      setPending(false);
    }
  };

  const runTarget = async () => {
    if (!launchpadAddress || !address || targetReview === null || pending)
      return;
    setPending(true);
    setHash(null);
    setError("");
    setMessage("Confirm the graduation target update in your wallet.");
    try {
      const simulation = await simulateContract(wagmiConfig, {
        address: launchpadAddress,
        abi: curveLaunchpadAbi,
        functionName: "setGraduationTarget",
        args: [targetReview],
        account: address,
        chainId: activeChainId,
      });
      const tx = await writeContract(wagmiConfig, simulation.request);
      setHash(tx);
      const receipt = await waitForTransactionReceipt(wagmiConfig, {
        hash: tx,
        chainId: activeChainId,
      });
      if (receipt.status !== "success")
        throw new Error("Graduation target transaction reverted.");
      setTarget(targetReview);
      setTargetDraft(formatEther(targetReview));
      setTargetReview(null);
      setMessage("Graduation target updated for future launches.");
    } catch (cause) {
      setError(readableError(cause, "Graduation target update failed."));
      setMessage("");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="page-main admin-page wrap">
      <h1 className="visually-hidden">Admin controls</h1>
      {!address || !isAdmin ? null : !configured ? (
        <section className="admin-panel admin-state">
          <h2>Launchpad unavailable</h2>
          <p>Configure the active launchpad before managing settings.</p>
        </section>
      ) : loading && !settings ? (
        <section className="admin-panel admin-state" aria-busy="true">
          Reading launchpad settings…
        </section>
      ) : !settings ? (
        <section className="admin-panel admin-state" role="alert">
          {error || "Could not read launchpad settings."}
        </section>
      ) : (
        <>
          {!correctChain && (
            <div className="notice admin-notice" role="status">
              Switch to the configured network to submit transactions.{" "}
              <button
                type="button"
                onClick={() => switchChain({ chainId: activeChainId })}
              >
                Switch network
              </button>
            </div>
          )}
          {error && (
            <p className="notice admin-notice" role="alert">
              {error}
            </p>
          )}
          {(message || hash) && (
            <p className="admin-feedback" role="status">
              {message || "Check the submitted transaction before retrying."}{" "}
              {hash && (
                <a
                  href={`${activeExplorerUrl}/tx/${hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction ↗
                </a>
              )}
            </p>
          )}
          {loading && !settings ? (
            <section className="admin-panel admin-state" aria-busy="true">
              Reading launchpad settings…
            </section>
          ) : (
            settings && (
              <>
                <div className="admin-grid">
                  {target !== null &&
                    settings.owner.toLowerCase() === address.toLowerCase() && (
                      <section
                        className="admin-panel admin-fee-panel"
                        aria-labelledby="admin-target-title"
                      >
                        <div className="admin-panel-head">
                          <h2 id="admin-target-title">Graduation target</h2>
                          <div className="admin-current-fee">
                            <span>Current target</span>
                            <strong>{formatEther(target)} WETH</strong>
                          </div>
                        </div>
                        <p className="admin-description">
                          Collected WETH sent to the pool when the curve sells
                          out. Changes apply to future launches only.
                        </p>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            try {
                              const next = parseEther(targetDraft.trim());
                              if (next <= 0n || next === target)
                                throw new Error(
                                  "Enter a new positive WETH amount.",
                                );
                              setTargetReview(next);
                              setTargetError("");
                            } catch (cause) {
                              setTargetError(readableError(cause));
                            }
                          }}
                        >
                          <label className="admin-label" htmlFor="admin-target">
                            New graduation target in WETH
                          </label>
                          <div className="admin-fee-input">
                            <input
                              id="admin-target"
                              type="text"
                              inputMode="decimal"
                              value={targetDraft}
                              disabled={pending || !correctChain}
                              aria-invalid={Boolean(targetError)}
                              aria-describedby={
                                targetError ? "admin-target-error" : undefined
                              }
                              onChange={(event) => {
                                setTargetDraft(event.target.value);
                                setTargetReview(null);
                                setTargetError("");
                              }}
                            />
                            <span>WETH</span>
                          </div>
                          {targetError && (
                            <p
                              id="admin-target-error"
                              className="notice"
                              role="alert"
                            >
                              {targetError}
                            </p>
                          )}
                          {targetReview === null ? (
                            <button
                              type="submit"
                              className="primary-button"
                              disabled={pending || !correctChain}
                            >
                              Review target
                            </button>
                          ) : (
                            <div className="admin-review">
                              <p>
                                Set the target for future launches to{" "}
                                <strong>
                                  {formatEther(targetReview)} WETH
                                </strong>
                                ?
                              </p>
                              <div className="admin-actions">
                                <button
                                  type="button"
                                  className="primary-button"
                                  disabled={pending || !correctChain}
                                  onClick={() => void runTarget()}
                                >
                                  {pending
                                    ? "Waiting for confirmation…"
                                    : "Confirm in wallet"}
                                </button>
                                <button
                                  type="button"
                                  className="admin-secondary"
                                  disabled={pending}
                                  onClick={() => setTargetReview(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </form>
                      </section>
                    )}
                  <section
                    className="admin-panel admin-fee-panel"
                    aria-labelledby="admin-fee-title"
                  >
                    <div className="admin-panel-head">
                      <h2 id="admin-fee-title">Curve trading fee</h2>
                      <div className="admin-fee-metrics">
                        <div className="admin-current-fee">
                          <span>Current fee</span>
                          <strong>{(settings.feeBps / 100).toFixed(2)}%</strong>
                        </div>
                        <button
                          type="button"
                          className="market-refresh admin-refresh"
                          disabled={pending || loading}
                          aria-label={
                            loading
                              ? "Refreshing chain data"
                              : "Refresh chain data"
                          }
                          aria-busy={loading}
                          title={
                            loading
                              ? "Refreshing chain data"
                              : "Refresh chain data"
                          }
                          onClick={() => void refresh(false)}
                        >
                          <svg
                            viewBox="0 0 20 20"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M16.8 8A7 7 0 1 0 17 11" />
                            <path d="M17 3.5V8h-4.5" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <p className="admin-description">
                      Future launches only. Existing market fees stay fixed.
                    </p>
                    {settings.owner.toLowerCase() === address.toLowerCase() ? (
                      <form onSubmit={onReview}>
                        <label className="admin-label" htmlFor="admin-fee">
                          New trading fee
                        </label>
                        <div className="admin-fee-input">
                          <input
                            ref={feeInputRef}
                            id="admin-fee"
                            type="text"
                            inputMode="decimal"
                            value={draft}
                            disabled={pending || !correctChain}
                            aria-invalid={Boolean(fieldError)}
                            aria-describedby={
                              fieldError
                                ? "admin-fee-help admin-fee-error"
                                : "admin-fee-help"
                            }
                            onChange={(event) => {
                              setDraft(event.target.value);
                              setReviewBps(null);
                              setFieldError("");
                            }}
                          />
                          <span>%</span>
                        </div>
                        <p id="admin-fee-help" className="admin-help">
                          0.00%–5.00% · 0.01% steps
                        </p>
                        {fieldError && (
                          <p
                            id="admin-fee-error"
                            className="notice"
                            role="alert"
                          >
                            {fieldError}
                          </p>
                        )}
                        {reviewBps === null ? (
                          <button
                            type="submit"
                            className="primary-button"
                            disabled={pending || !correctChain || loading}
                          >
                            Review change
                          </button>
                        ) : (
                          <div
                            className="admin-review"
                            role="group"
                            aria-label="Review fee update"
                          >
                            <p>
                              Change future launch fees from{" "}
                              <strong>
                                {(settings.feeBps / 100).toFixed(2)}%
                              </strong>{" "}
                              to{" "}
                              <strong>{(reviewBps / 100).toFixed(2)}%</strong>?
                            </p>
                            <div className="admin-actions">
                              <button
                                ref={confirmRef}
                                type="button"
                                className="primary-button"
                                disabled={pending || !correctChain}
                                onClick={() => void run()}
                              >
                                {pending
                                  ? "Waiting for confirmation…"
                                  : "Confirm in wallet"}
                              </button>
                              <button
                                type="button"
                                className="admin-secondary"
                                disabled={pending}
                                onClick={() => {
                                  setReviewBps(null);
                                  feeInputRef.current?.focus();
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </form>
                    ) : (
                      <p className="admin-help">
                        Fee editing unavailable for this wallet.
                      </p>
                    )}
                  </section>
                  <div className="admin-side">
                    {funds && <FundsPanel funds={funds} />}
                    <FactoryDetails
                      settings={settings}
                      factory={launchpadAddress!}
                    />
                  </div>
                </div>
                {socialApiConfigured ? (
                  <section
                    className="admin-panel moderation-panel"
                    aria-labelledby="moderation-title"
                  >
                    <div className="admin-side-head">
                      <h2 id="moderation-title">Open reports</h2>
                      <span>{moderation.data?.items.length ?? 0}</span>
                    </div>
                    {moderation.isLoading ? (
                      <p aria-busy="true">Loading moderation queue…</p>
                    ) : moderation.isError ? (
                      <div className="admin-state">
                        <p>
                          {moderation.error instanceof Error
                            ? moderation.error.message
                            : "Moderation queue unavailable."}
                        </p>
                        <button
                          className="primary-button"
                          type="button"
                          onClick={async () => {
                            await ensureAuthenticated();
                            await moderation.refetch();
                          }}
                        >
                          Sign in and retry
                        </button>
                      </div>
                    ) : !moderation.data?.items.length ? (
                      <p className="admin-help">No open reports.</p>
                    ) : (
                      <ol>
                        {moderation.data.items.map((report) => (
                          <ModerationRow
                            key={report.id}
                            report={report}
                            pending={updateReport.isPending}
                            onUpdate={(id, status, note) =>
                              updateReport.mutate({ id, status, note })
                            }
                          />
                        ))}
                      </ol>
                    )}
                    {updateReport.error ? (
                      <p className="notice" role="alert">
                        {updateReport.error.message}
                      </p>
                    ) : null}
                  </section>
                ) : null}
              </>
            )
          )}
        </>
      )}
    </main>
  );
}
