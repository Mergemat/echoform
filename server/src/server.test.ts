import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

// ── Test Setup ──────────────────────────────────────────────────────

const TEST_PORT = 19_731;
const BASE = `http://localhost:${TEST_PORT}`;
const ALLOWED_ORIGIN = `http://localhost:${TEST_PORT}`;
const DISALLOWED_ORIGIN = "http://evil.example.com";

let serverProcess: Subprocess;
let sessionCookie: string;
let tmpDir: string;

async function waitForServer(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/session`);
      if (res.ok) {
        return;
      }
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }
  throw new Error("Server did not start in time");
}

/** Bootstrap a session and return the cookie string for authenticated requests. */
async function getSessionCookie(): Promise<string> {
  const res = await fetch(`${BASE}/api/session`, {
    headers: { Origin: ALLOWED_ORIGIN },
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  // Extract just the cookie key=value (before any attributes like Path, HttpOnly)
  return setCookie?.split(";")[0]!;
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "echoform-test-"));

  serverProcess = Bun.spawn(["bun", join(import.meta.dir, "server.ts")], {
    cwd: tmpDir,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForServer();
  sessionCookie = await getSessionCookie();
}, 10_000);

afterAll(async () => {
  serverProcess.kill();
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────────

function authedHeaders(origin = ALLOWED_ORIGIN): HeadersInit {
  return { Origin: origin, Cookie: sessionCookie };
}

// ── 1. Origin Allowlist ─────────────────────────────────────────────

describe("Origin allowlist", () => {
  test("CORS preflight from allowed origin returns 204", async () => {
    const res = await fetch(`${BASE}/api/projects`, {
      method: "OPTIONS",
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
  });

  test("CORS preflight from disallowed origin returns 403", async () => {
    const res = await fetch(`${BASE}/api/projects`, {
      method: "OPTIONS",
      headers: { Origin: DISALLOWED_ORIGIN },
    });
    expect(res.status).toBe(403);
  });

  test("CORS preflight without origin returns 403", async () => {
    const res = await fetch(`${BASE}/api/projects`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(403);
  });

  test("/api/session from disallowed origin returns 403", async () => {
    const res = await fetch(`${BASE}/api/session`, {
      headers: { Origin: DISALLOWED_ORIGIN },
    });
    expect(res.status).toBe(403);
  });

  test("/api/session without origin succeeds (same-origin)", async () => {
    const res = await fetch(`${BASE}/api/session`);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeTruthy();
  });

  test("API response includes correct CORS header for allowed origin", async () => {
    const res = await fetch(`${BASE}/api/projects`, {
      headers: authedHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
  });

  test("API response omits CORS header for requests without origin", async () => {
    const res = await fetch(`${BASE}/api/projects`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

// ── 2. Session Cookie Auth ──────────────────────────────────────────

describe("Session cookie auth", () => {
  test("/api/session sets HttpOnly SameSite=Strict cookie", async () => {
    const res = await fetch(`${BASE}/api/session`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("echoform_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
  });

  test("API request without cookie returns 401", async () => {
    const res = await fetch(`${BASE}/api/projects`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("API request with invalid cookie returns 401", async () => {
    const res = await fetch(`${BASE}/api/projects`, {
      headers: { Cookie: "echoform_session=invalid-token" },
    });
    expect(res.status).toBe(401);
  });

  test("API request with valid cookie returns 200", async () => {
    const res = await fetch(`${BASE}/api/projects`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toBeArray();
  });

  test("API request with valid cookie + disallowed origin returns 403", async () => {
    const res = await fetch(`${BASE}/api/projects`, {
      headers: { Origin: DISALLOWED_ORIGIN, Cookie: sessionCookie },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });
});

// ── 3. WebSocket Auth ───────────────────────────────────────────────

describe("WebSocket auth", () => {
  test("WS upgrade from disallowed origin returns 403", async () => {
    // Use a plain HTTP request to /ws to check the rejection
    // (WebSocket constructor would throw, so we test via fetch)
    const res = await fetch(`${BASE}/ws`, {
      headers: {
        Origin: DISALLOWED_ORIGIN,
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": btoa("test-key"),
        "Sec-WebSocket-Version": "13",
      },
    });
    expect(res.status).toBe(403);
  });

  test("WS upgrade without cookie returns 401", async () => {
    const res = await fetch(`${BASE}/ws`, {
      headers: {
        Origin: ALLOWED_ORIGIN,
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": btoa("test-key"),
        "Sec-WebSocket-Version": "13",
      },
    });
    expect(res.status).toBe(401);
  });

  test("WS upgrade with valid cookie + allowed origin succeeds", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`, {
      headers: {
        Origin: ALLOWED_ORIGIN,
        Cookie: sessionCookie,
      },
    } as unknown as string[]);

    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    });
    expect(opened).toBe(true);

    // Should receive initial projects message
    const firstMessage = await new Promise<string>((resolve, reject) => {
      ws.onmessage = (e) => resolve(String(e.data));
      setTimeout(() => reject(new Error("No message received")), 3000);
    });
    const parsed = JSON.parse(firstMessage);
    expect(parsed.type).toBe("snapshot");
    expect(Array.isArray(parsed.projects)).toBe(true);
    expect(Array.isArray(parsed.roots)).toBe(true);
    expect(Array.isArray(parsed.activity)).toBe(true);

    ws.close();
  });
});

// ── 4. Path Traversal Protection ────────────────────────────────────

describe("Path traversal protection", () => {
  test("/api/media rejects absolute path outside project", async () => {
    const res = await fetch(`${BASE}/api/media?path=/etc/passwd`, {
      headers: authedHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("File not found");
  });

  test("/api/media rejects relative path traversal", async () => {
    const res = await fetch(
      `${BASE}/api/media?path=${encodeURIComponent("../../etc/passwd")}`,
      { headers: authedHeaders() }
    );
    expect(res.status).toBe(404);
  });

  test("/api/media rejects arbitrary file path", async () => {
    const res = await fetch(
      `${BASE}/api/media?path=${encodeURIComponent("/tmp/somefile.wav")}`,
      { headers: authedHeaders() }
    );
    expect(res.status).toBe(404);
  });

  test("/api/media requires path parameter", async () => {
    const res = await fetch(`${BASE}/api/media`, {
      headers: authedHeaders(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("path required");
  });

  test("/api/media requires auth", async () => {
    const res = await fetch(`${BASE}/api/media?path=/etc/passwd`);
    expect(res.status).toBe(401);
  });
});

// ── 5. toggleWatching Service ───────────────────────────────────────

describe("toggleWatching service", () => {
  test("toggleWatching persists watching state", async () => {
    const { EchoformService } = await import("./core");
    const stateDir = join(tmpDir, "toggle-test-state");
    const svc = new EchoformService(stateDir);

    // Create a temp project dir with a minimal .als file
    const projectDir = join(tmpDir, "test-project");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "test.als"), "fake-als-content");

    const project = await svc.trackProject({ projectPath: projectDir });
    expect(project.watching).toBe(true);

    const updated = await svc.toggleWatching(project.id, false);
    expect(updated.watching).toBe(false);

    const restored = await svc.toggleWatching(project.id, true);
    expect(restored.watching).toBe(true);
  });
});
