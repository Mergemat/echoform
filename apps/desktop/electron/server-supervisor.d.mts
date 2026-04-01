declare module "./server-supervisor.mjs" {
  export const SERVER_RESTART_BASE_DELAY_MS: number;
  export const SERVER_RESTART_MAX_DELAY_MS: number;

  export function getServerRestartDelayMs(attempt: number): number;
}

export {};
