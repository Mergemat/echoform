import { describe, expect, it } from "vitest";
import {
  getServerRestartDelayMs,
  SERVER_RESTART_BASE_DELAY_MS,
  SERVER_RESTART_MAX_DELAY_MS,
} from "./server-supervisor.mjs";

describe("getServerRestartDelayMs", () => {
  it("starts at the base delay", () => {
    expect(getServerRestartDelayMs(0)).toBe(SERVER_RESTART_BASE_DELAY_MS);
  });

  it("doubles until it reaches the cap", () => {
    expect(getServerRestartDelayMs(1)).toBe(2000);
    expect(getServerRestartDelayMs(2)).toBe(4000);
    expect(getServerRestartDelayMs(3)).toBe(8000);
  });

  it("caps large retry counts", () => {
    expect(getServerRestartDelayMs(10)).toBe(SERVER_RESTART_MAX_DELAY_MS);
  });

  it("treats negative attempts as the first retry", () => {
    expect(getServerRestartDelayMs(-1)).toBe(SERVER_RESTART_BASE_DELAY_MS);
  });
});
