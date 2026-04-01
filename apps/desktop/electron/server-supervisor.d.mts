export declare const SERVER_RESTART_BASE_DELAY_MS: number;
export declare const SERVER_RESTART_MAX_DELAY_MS: number;

export declare function getServerRestartDelayMs(attempt: number): number;

export declare function resolveAvailablePort(
  preferredPort: number,
  host?: string
): Promise<number>;
