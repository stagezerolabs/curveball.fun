import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../app/useStore.js";

const TOAST_MS = 3_000;
const ERROR_TOAST_MS = 6_000;

export function toastTone(message: string) {
  if (message.startsWith("Bought")) return "buy";
  if (message.startsWith("Sold")) return "sell";
  return "claim";
}

function Toast({
  message,
  tone,
  duration,
  onDone,
}: {
  message: string;
  tone: string;
  duration: number;
  onDone: () => void;
}) {
  useEffect(() => {
    const timeout = setTimeout(onDone, duration);
    return () => clearTimeout(timeout);
  }, [message, duration, onDone]);
  const isError = tone === "error";
  return (
    <div
      className={`trade-toast ${tone}`}
      role={isError ? "alert" : "status"}
      style={{ animationDuration: `${duration}ms` }}
    >
      <span className="trade-toast-dot" aria-hidden="true" />
      <span className="trade-toast-text">{message}</span>
      {isError && (
        <button type="button" onClick={onDone} aria-label="Dismiss error">
          ×
        </button>
      )}
    </div>
  );
}

// Trade, fee-claim, and error messages toast in, hold briefly, and leave.
export function ActionToast() {
  const { tradeMessage, actionError, isPending, clearTradeMessage, setActionError } =
    useStore() as {
      tradeMessage: string;
      actionError: string;
      isPending: boolean;
      clearTradeMessage: () => void;
      setActionError: (error: string) => void;
    };
  if (typeof document === "undefined") return null;
  const showMessage = Boolean(tradeMessage) && !isPending;
  if (!showMessage && !actionError) return null;
  return createPortal(
    <div className="toast-stack" aria-live="polite">
      {actionError && (
        <Toast
          key={`error:${actionError}`}
          message={actionError}
          tone="error"
          duration={ERROR_TOAST_MS}
          onDone={() => setActionError("")}
        />
      )}
      {showMessage && (
        <Toast
          key={`message:${tradeMessage}`}
          message={tradeMessage}
          tone={toastTone(tradeMessage)}
          duration={TOAST_MS}
          onDone={clearTradeMessage}
        />
      )}
    </div>,
    document.body,
  );
}
