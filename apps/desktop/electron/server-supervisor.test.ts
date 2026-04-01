import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  getServerRestartDelayMs,
  resolveAvailablePort,
  SERVER_RESTART_BASE_DELAY_MS,
  SERVER_RESTART_MAX_DELAY_MS,
} from "./server-supervisor.mjs";

const serversToClose = new Set<net.Server>();

afterEach(async () => {
  await Promise.all(
    [...serversToClose].map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(undefined);
          });
        })
    )
  );
  serversToClose.clear();
});

async function occupyPort(host = "127.0.0.1") {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve());
  });
  serversToClose.add(server);
  const address = server.address();
  if (!(address && typeof address === "object")) {
    throw new Error("Expected TCP address");
  }
  return address.port;
}

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

describe("resolveAvailablePort", () => {
  it("uses the preferred port when it is free", async () => {
    const preferredPort = await occupyPort();
    const reservedServer = [...serversToClose].at(-1);
    if (!reservedServer) {
      throw new Error("Expected reserved server");
    }

    await new Promise<void>((resolve, reject) => {
      reservedServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(undefined);
      });
    });
    serversToClose.delete(reservedServer);

    await expect(resolveAvailablePort(preferredPort)).resolves.toBe(preferredPort);
  });

  it("falls back when the preferred port is occupied", async () => {
    const preferredPort = await occupyPort();
    const resolvedPort = await resolveAvailablePort(preferredPort);

    expect(resolvedPort).not.toBe(preferredPort);
    expect(resolvedPort).toBeGreaterThan(0);
  });
});
