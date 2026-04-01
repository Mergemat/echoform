import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url)).replace(
  /\/scripts$/,
  ""
);
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

async function waitFor(url: string, label: string): Promise<void> {
  const timeoutMs = 20_000;
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
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
  launch("bun", ["--watch", "../../packages/server/src/server.ts"], {
    ECHOFORM_HOST: "127.0.0.1",
    ECHOFORM_ALLOWED_ORIGINS: rendererOrigin,
    ECHOFORM_SESSION_BOOTSTRAP_TOKEN: sessionBootstrapToken,
  });
  await waitFor("http://127.0.0.1:3001/api/session", "Echoform server");
  launch("bun", ["run", "dev:client"]);
  await waitFor(rendererUrl, "Vite client");

  launch("bunx", ["electron", "electron/main.mjs"], {
    ECHOFORM_API_URL: "http://127.0.0.1:3001",
    ECHOFORM_RENDERER_URL: rendererUrl,
    ECHOFORM_SESSION_BOOTSTRAP_TOKEN: sessionBootstrapToken,
  });
}

await main();
