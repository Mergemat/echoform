import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAvailablePort } from "../electron/server-supervisor.mjs";

const rootDir = dirname(fileURLToPath(import.meta.url)).replace(
  /\/scripts$/,
  ""
);
const devStateDir = join(rootDir, ".echoform-state");
const legacyDevStateDir = join(rootDir, ".ablegit-state");
const serverHost = "127.0.0.1";
const defaultServerPort = 3001;
const rendererUrl = "http://127.0.0.1:5193";
const rendererOrigin = new URL(rendererUrl).origin;
const sessionBootstrapToken = crypto.randomUUID();
const processes: ReturnType<typeof spawn>[] = [];
let shuttingDown = false;

function launch(
  command: string,
  args: string[],
  extraEnv?: Record<string, string>
) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });

  processes.push(child);
  child.once("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const proc of processes) {
      if (proc !== child && proc.exitCode === null && !proc.killed) {
        proc.kill("SIGTERM");
      }
    }
    process.exit(code ?? (signal ? 1 : 0));
  });

  return child;
}

async function waitFor(
  url: string,
  label: string,
  init?: RequestInit
): Promise<void> {
  const timeoutMs = 20_000;
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        return;
      }
      lastError = new Error(`${label} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for ${label}`);
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const proc of processes) {
    if (proc.exitCode === null && !proc.killed) {
      proc.kill("SIGTERM");
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  const serverPort = await resolveAvailablePort(defaultServerPort, serverHost);
  const serverBaseUrl = `http://${serverHost}:${serverPort}`;

  launch("bun", ["run", "dev:server"], {
    PORT: String(serverPort),
    ECHOFORM_HOST: serverHost,
    ECHOFORM_ALLOWED_ORIGINS: rendererOrigin,
    ECHOFORM_SESSION_BOOTSTRAP_TOKEN: sessionBootstrapToken,
    ECHOFORM_STATE_DIR: devStateDir,
    ABLEGIT_STATE_DIR: legacyDevStateDir,
  });
  await waitFor(`${serverBaseUrl}/api/session`, "Echoform server", {
    headers: {
      "X-Echoform-Session-Bootstrap": sessionBootstrapToken,
    },
  });
  launch("bun", ["run", "dev:client"], {
    ECHOFORM_DEV_SERVER_PORT: String(serverPort),
  });
  await waitFor(rendererUrl, "Vite client");

  launch("bunx", ["electron", "electron/main.mjs"], {
    ECHOFORM_API_URL: serverBaseUrl,
    ECHOFORM_RENDERER_URL: rendererUrl,
    ECHOFORM_SESSION_BOOTSTRAP_TOKEN: sessionBootstrapToken,
  });
}

await main();
