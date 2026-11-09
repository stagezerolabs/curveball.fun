const MAX_RETRY_MS = 6 * 3_600_000;
export const FAILURE_RETRY_MS = 60_000;

export function createRetryPolicy({ now, logger }) {
  const retryAfter = new Map();
  const failures = new Map();

  function backOff(key, token, reason, baseMs) {
    const attempts = (failures.get(key) ?? 0) + 1;
    failures.set(key, attempts);
    const delay = Math.min(
      baseMs * 2 ** Math.min(attempts - 1, 8),
      MAX_RETRY_MS,
    );
    retryAfter.set(key, now() + delay);
    logger.warn(
      `${reason} for ${token}; retrying in ${Math.round(delay / 1_000)} seconds.`,
    );
  }

  function clearBackOff(key) {
    retryAfter.delete(key);
    failures.delete(key);
  }

  function canAttempt(key, at = now()) {
    return (retryAfter.get(key) ?? 0) <= at;
  }

  return { backOff, clearBackOff, canAttempt };
}
