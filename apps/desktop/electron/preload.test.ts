import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { exposeEchoformApi, resolvePreloadConfig } = require("./preload.cjs") as {
  resolvePreloadConfig: (
    argv?: string[],
    env?: Record<string, string | undefined>
  ) => {
    apiBaseUrl?: string;
    sessionBootstrapToken?: string;
  };
  exposeEchoformApi: (
    electron: {
      contextBridge?: { exposeInMainWorld?: ReturnType<typeof vi.fn> };
      ipcRenderer?: {
        invoke: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
        removeListener: ReturnType<typeof vi.fn>;
      };
    },
    preloadConfig?: {
      apiBaseUrl?: string;
      sessionBootstrapToken?: string;
    }
  ) => void;
};

describe("preload", () => {
  it("reads the bootstrap token from additional arguments", () => {
    const config = resolvePreloadConfig(
      [
        "electron",
        "app",
        "--echoform-session-bootstrap-token=shared-token",
      ],
      {}
    );

    expect(config.sessionBootstrapToken).toBe("shared-token");
  });

  it("reads the api base url from additional arguments", () => {
    const config = resolvePreloadConfig(
      ["electron", "app", "--echoform-api-base-url=http://127.0.0.1:61669"],
      {}
    );

    expect(config.apiBaseUrl).toBe("http://127.0.0.1:61669");
  });

  it("falls back to environment variables when no arguments are present", () => {
    const config = resolvePreloadConfig([], {
      ECHOFORM_API_URL: "http://127.0.0.1:3001",
      ECHOFORM_SESSION_BOOTSTRAP_TOKEN: "env-token",
    });

    expect(config).toEqual({
      apiBaseUrl: "http://127.0.0.1:3001",
      sessionBootstrapToken: "env-token",
    });
  });

  it("exposes the resolved API onto the renderer bridge", () => {
    const exposeInMainWorld = vi.fn();
    const invoke = vi.fn();
    const on = vi.fn();
    const removeListener = vi.fn();

    exposeEchoformApi(
      {
        contextBridge: { exposeInMainWorld },
        ipcRenderer: { invoke, on, removeListener },
      },
      {
        apiBaseUrl: "http://127.0.0.1:3001",
        sessionBootstrapToken: "shared-token",
      }
    );

    expect(exposeInMainWorld).toHaveBeenCalledWith(
      "echoform",
      expect.objectContaining({
        apiBaseUrl: "http://127.0.0.1:3001",
        sessionBootstrapToken: "shared-token",
      })
    );
  });
});
