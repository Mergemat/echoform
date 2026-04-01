import net from "node:net";

export const SERVER_RESTART_BASE_DELAY_MS = 1000;
export const SERVER_RESTART_MAX_DELAY_MS = 30_000;

export function getServerRestartDelayMs(attempt) {
  const normalizedAttempt = Math.max(0, attempt);
  return Math.min(
    SERVER_RESTART_BASE_DELAY_MS * 2 ** normalizedAttempt,
    SERVER_RESTART_MAX_DELAY_MS
  );
}

function listenOnce(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();

    server.once("error", (error) => {
      server.close(() => {
        reject(error);
      });
    });

    server.listen(port, host, () => {
      const address = server.address();
      if (!(address && typeof address === "object")) {
        server.close(() => reject(new Error("Failed to resolve server port")));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

export async function resolveAvailablePort(preferredPort, host = "127.0.0.1") {
  try {
    return await listenOnce(preferredPort, host);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error)) {
      throw error;
    }

    const code = error.code;
    if (code !== "EADDRINUSE" && code !== "EACCES") {
      throw error;
    }

    return listenOnce(0, host);
  }
}
