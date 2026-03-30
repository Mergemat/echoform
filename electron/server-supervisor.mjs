export const SERVER_RESTART_BASE_DELAY_MS = 1_000;
export const SERVER_RESTART_MAX_DELAY_MS = 30_000;

export function getServerRestartDelayMs(attempt) {
  const normalizedAttempt = Math.max(0, attempt);
  return Math.min(
    SERVER_RESTART_BASE_DELAY_MS * 2 ** normalizedAttempt,
    SERVER_RESTART_MAX_DELAY_MS
  );
}
