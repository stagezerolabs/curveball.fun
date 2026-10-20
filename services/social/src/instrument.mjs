// Preload this module before the service entrypoint so HTTP and database work can be traced.
const Sentry = process.versions.bun
  ? await import("@sentry/bun")
  : await import("@sentry/node");

const dsn = process.env.SENTRY_DSN?.trim();
if (dsn) {
  const configuredRate = process.env.SENTRY_TRACES_SAMPLE_RATE;
  const tracesSampleRate = configuredRate?.trim()
    ? Number(configuredRate)
    : (process.env.NODE_ENV === "production" ? 0.1 : 1);
  if (!Number.isFinite(tracesSampleRate) || tracesSampleRate < 0 || tracesSampleRate > 1) {
    throw new Error("SENTRY_TRACES_SAMPLE_RATE must be between 0 and 1.");
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    tracesSampleRate,
    sendDefaultPii: false,
  });
}

export function captureBackendException(error, processName) {
  if (!dsn) return;
  Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
    tags: { process: processName },
  });
}

export function traceBackendTask(name, task) {
  return dsn ? Sentry.startSpan({ name, op: "task" }, task) : task();
}

export async function flushBackendEvents() {
  if (dsn) await Sentry.flush(2_000);
}
