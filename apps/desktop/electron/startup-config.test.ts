import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  resolveStartupConfig,
} from "./startup-config.mjs";

describe("startup config", () => {
  it("uses sane desktop defaults", () => {
    expect(DEFAULT_SERVER_HOST).toBe("127.0.0.1");
    expect(DEFAULT_SERVER_PORT).toBe(3001);
  });

  it("reuses a provided bootstrap token", () => {
    const config = resolveStartupConfig({
      ECHOFORM_SESSION_BOOTSTRAP_TOKEN: "shared-token",
    });

    expect(config.sessionBootstrapToken).toBe("shared-token");
  });

  it("falls back to generating a token when none is provided", () => {
    const config = resolveStartupConfig({}, () => "generated-token");

    expect(config.sessionBootstrapToken).toBe("generated-token");
  });

  it("keeps renderer and api URLs distinct", () => {
    const config = resolveStartupConfig({
      ECHOFORM_RENDERER_URL: "http://127.0.0.1:5193",
      ECHOFORM_API_URL: "http://127.0.0.1:61669",
    });

    expect(config.rendererUrl).toBe("http://127.0.0.1:5193");
    expect(config.apiBaseUrlOverride).toBe("http://127.0.0.1:61669");
  });
});
