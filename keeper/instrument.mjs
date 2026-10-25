import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN?.trim();
if (dsn) {
  const configuredRate = process.env.SENTRY_TRACES_SAMPLE_RATE;
  const tracesSampleRate = configuredRate?.trim()
    ? Number(configuredRate)
    : process.env.NODE_ENV === "production"
      ? 0.1
      : 1;
  if (
    !Number.isFinite(tracesSampleRate) ||
    tracesSampleRate < 0 ||
    tracesSampleRate > 1
  ) {
    throw new Error("SENTRY_TRACES_SAMPLE_RATE must be between 0 and 1.");
  }

  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    tracesSampleRate,
    sendDefaultPii: false,
  });
}

export function captureKeeperException(error, operation) {
  if (!dsn) return;
  Sentry.captureException(
    error instanceof Error ? error : new Error(String(error)),
    {
      tags: { process: "keeper", operation },
    },
  );
}

export function traceKeeperSweep(task) {
  return dsn
    ? Sentry.startSpan({ name: "keeper.sweep", op: "task" }, task)
    : task();
}

export async function flushKeeperEvents() {
  if (dsn) await Sentry.flush(2_000);
}
