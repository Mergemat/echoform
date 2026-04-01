import { access } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { AppError, EchoformService } from "./core";
import { discoverProjects } from "./discovery";
import { resolveStateDir } from "./paths";
import type { WsCommand, WsEvent } from "./types";
import { ProjectWatcher, RootWatcher } from "./watcher";

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.ECHOFORM_HOST?.trim() || "127.0.0.1";
const service = new EchoformService(resolveStateDir());
const clients = new Set<{ send: (data: string) => void }>();
const SESSION_COOKIE_NAME = "echoform_session";
const SESSION_TOKEN = crypto.randomUUID();
const SESSION_BOOTSTRAP_HEADER = "x-echoform-session-bootstrap";
const SESSION_BOOTSTRAP_TOKEN =
  process.env.ECHOFORM_SESSION_BOOTSTRAP_TOKEN?.trim() || null;
const STATIC_DIR = resolve(
  process.env.ECHOFORM_STATIC_DIR ??
    process.env.ABLEGIT_STATIC_DIR ??
    join(process.cwd(), "dist")
);
const DEFAULT_ALLOWED_ORIGINS = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const allowedOrigins = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...((
    process.env.ECHOFORM_ALLOWED_ORIGINS ?? process.env.ABLEGIT_ALLOWED_ORIGINS
  )
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? []),
]);
const PREVIEW_POLL_MS = 1500;
const MAX_PREVIEW_UPLOAD_BYTES = 50 * 1024 * 1024;

function broadcast(event: WsEvent) {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    try {
      ws.send(data);
    } catch {
      clients.delete(ws);
    }
  }
}

async function buildSnapshotEvent(): Promise<WsEvent> {
  const { projects, roots, activity } = await service.getSnapshot();
  return {
    type: "snapshot",
    projects,
    roots,
    activity,
  };
}

async function broadcastSnapshot(): Promise<void> {
  broadcast(await buildSnapshotEvent());
}

async function backfillSaveAnalysis(
  projectId: string,
  saveId: string
): Promise<void> {
  try {
    const { project } = await service.computeChanges(projectId, saveId);
    broadcast({ type: "project-updated", project });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Background save analysis failed";
    broadcast({ type: "error", message });
  }
}

function isAllowedOrigin(origin: string | null): origin is string {
  return origin !== null && allowedOrigins.has(origin);
}

function parseCookies(req: Request): Map<string, string> {
  const raw = req.headers.get("cookie");
  if (!raw) {
    return new Map();
  }
  return new Map(
    raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf("=");
        if (idx === -1) {
          return [part, ""] as const;
        }
        return [
          decodeURIComponent(part.slice(0, idx)),
          decodeURIComponent(part.slice(idx + 1)),
        ] as const;
      })
  );
}

function isLoopbackRequest(req: Request): boolean {
  const url = new URL(req.url);
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

function isAuthorized(req: Request): boolean {
  return parseCookies(req).get(SESSION_COOKIE_NAME) === SESSION_TOKEN;
}

function hasValidBootstrapToken(req: Request): boolean {
  return (
    SESSION_BOOTSTRAP_TOKEN !== null &&
    req.headers.get(SESSION_BOOTSTRAP_HEADER) === SESSION_BOOTSTRAP_TOKEN
  );
}

function createSessionCookie(req: Request): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(SESSION_TOKEN)}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

function responseHeaders(req: Request, extra: HeadersInit = {}): HeadersInit {
  const origin = req.headers.get("origin");
  if (isAllowedOrigin(origin)) {
    return {
      ...extra,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
    };
  }
  return extra;
}

function corsHeaders(req: Request): HeadersInit | null {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return null;
  }
  return responseHeaders(req, {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
}

function authorizeHttp(req: Request): AppError | null {
  const origin = req.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    return new AppError("Forbidden", 403);
  }
  if (!isAuthorized(req)) {
    return new AppError("Unauthorized", 401);
  }
  return null;
}

// ── Watcher ─────────────────────────────────────────────────────────

const watcher = new ProjectWatcher({
  onChange: async (projectId, projectName, changedPaths) => {
    broadcast({ type: "change-detected", projectId, projectName });
    // suppress watcher while saving to prevent infinite loop
    watcher.suppress(projectId);
    try {
      const { project, save, stateChanged } =
        await service.handleWatchedAlsChange(projectId, changedPaths);
      if (save) {
        broadcast({ type: "auto-saved", projectId, save });
        void backfillSaveAnalysis(projectId, save.id);
      }
      if (save || stateChanged) {
        broadcast({ type: "project-updated", project });
        void broadcastSnapshot();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Auto-save failed";
      broadcast({ type: "error", message: msg });
    } finally {
      watcher.unsuppress(projectId);
    }
  },
  onError: async (projectId, _projectName, message) => {
    await service.setProjectWatchError(projectId, message);
    broadcast({ type: "error", message });
    await broadcastSnapshot();
  },
});

const rootWatcher = new RootWatcher({
  onChange: async () => {
    await service.syncRoots();
    await reconcileWatchers();
    await broadcastSnapshot();
  },
  onError: async (_rootId, _rootName, message) => {
    broadcast({ type: "error", message });
    await broadcastSnapshot();
  },
});

async function reconcileWatchers(): Promise<void> {
  const state = await service.loadState();
  watcher.unwatchAll();
  rootWatcher.unwatchAll();

  for (const root of state.roots) {
    await rootWatcher.watchRoot(root);
  }

  for (const project of state.projects) {
    if (project.watching && project.presence === "active") {
      await watcher.watchProject(project);
      if (project.watchError) {
        await service.clearProjectWatchError(project.id);
      }
    }
  }
}

// start watching all tracked projects on boot
(async () => {
  await service.syncRoots();
  await reconcileWatchers();
})();

setInterval(() => {
  void service
    .ingestPendingPreviews()
    .then(async (changed) => {
      if (!changed) {
        return;
      }
      await broadcastSnapshot();
    })
    .catch((err) => {
      const message =
        err instanceof Error ? err.message : "Preview ingest failed";
      broadcast({ type: "error", message });
    });
}, PREVIEW_POLL_MS);

// ── WebSocket command handler ───────────────────────────────────────

async function handleCommand(cmd: WsCommand): Promise<WsEvent | null> {
  switch (cmd.type) {
    case "track-project": {
      await service.trackProject({
        name: cmd.name,
        projectPath: cmd.projectPath,
      });
      await reconcileWatchers();
      return await buildSnapshotEvent();
    }
    case "delete-project": {
      watcher.unwatchProject(cmd.projectId);
      await service.deleteProject(cmd.projectId);
      await reconcileWatchers();
      return await buildSnapshotEvent();
    }
    case "add-root": {
      await service.addRoot({ path: cmd.path, name: cmd.name });
      await reconcileWatchers();
      return await buildSnapshotEvent();
    }
    case "remove-root": {
      await service.removeRoot(cmd.rootId);
      await reconcileWatchers();
      return await buildSnapshotEvent();
    }
    case "sync-roots": {
      await service.syncRoots();
      await reconcileWatchers();
      return await buildSnapshotEvent();
    }
    case "discover-root-suggestions": {
      const suggestions = await service.listRootSuggestions();
      return { type: "root-suggestions", suggestions };
    }
    case "create-save": {
      await service.createSave(cmd.projectId, {
        label: cmd.label,
        note: cmd.note,
      });
      return await buildSnapshotEvent();
    }
    case "branch-from-save": {
      watcher.suppress(cmd.projectId);
      try {
        const result = await service.branchFromSave(cmd.projectId, {
          saveId: cmd.saveId,
          name: cmd.name,
          fileName: cmd.fileName,
        });
        if (result.openError) {
          broadcast({ type: "error", message: result.openError });
        }
        return await buildSnapshotEvent();
      } finally {
        watcher.unsuppress(cmd.projectId);
      }
    }
    case "open-idea": {
      const result = await service.openIdea(cmd.projectId, cmd.ideaId);
      if (result.openError) {
        broadcast({ type: "error", message: result.openError });
      }
      return await buildSnapshotEvent();
    }
    case "reveal-idea-file": {
      const result = await service.revealIdeaFile(cmd.projectId, cmd.ideaId);
      if (result.openError) {
        broadcast({ type: "error", message: result.openError });
      }
      return await buildSnapshotEvent();
    }
    case "adopt-drift-file": {
      await service.adoptDriftFile(cmd.projectId);
      return await buildSnapshotEvent();
    }
    case "compare": {
      // compare returns via HTTP for simplicity
      return null;
    }
    case "update-save": {
      await service.updateSave(cmd.projectId, cmd.saveId, {
        note: cmd.note,
        label: cmd.label,
      });
      return await buildSnapshotEvent();
    }
    case "discover-projects": {
      const tracked = await service.listProjects();
      const roots = await service.listRoots();
      const paths = await discoverProjects(tracked, roots);
      return { type: "discovered-projects", paths };
    }
    case "toggle-watching": {
      if (cmd.watching) {
        // Watch first — only persist if the watcher starts successfully
        const state = await service.loadState();
        const project = state.projects.find((p) => p.id === cmd.projectId);
        if (!project) {
          return { type: "error", message: "Project not found" };
        }
        await watcher.watchProject(project);
        await service.toggleWatching(cmd.projectId, true);
        await reconcileWatchers();
        return await buildSnapshotEvent();
      }
      watcher.unwatchProject(cmd.projectId);
      await service.toggleWatching(cmd.projectId, false);
      await reconcileWatchers();
      return await buildSnapshotEvent();
    }
    case "delete-save": {
      await service.deleteSave(cmd.projectId, cmd.saveId);
      return await buildSnapshotEvent();
    }
  }
}

// ── HTTP routes (compare + media) ───────────────────────────────────

function jsonResponse(
  req: Request,
  data: unknown,
  status = 200,
  extraHeaders: HeadersInit = {}
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(req, {
      "Content-Type": "application/json",
      ...extraHeaders,
    }),
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolveStaticPath(pathname: string): string | null {
  const trimmed = pathname.replace(/^\/+/, "");
  const normalized = normalize(trimmed || "index.html");
  if (normalized.startsWith("..") || normalized.includes(`..${sep}`)) {
    return null;
  }
  return join(STATIC_DIR, normalized);
}

async function serveStatic(
  req: Request,
  pathname: string
): Promise<Response | null> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return null;
  }

  const filePath = resolveStaticPath(pathname);
  if (filePath && (await fileExists(filePath))) {
    return new Response(Bun.file(filePath), {
      headers: responseHeaders(req),
    });
  }

  if (extname(pathname)) {
    return null;
  }

  const indexPath = join(STATIC_DIR, "index.html");
  if (!(await fileExists(indexPath))) {
    return null;
  }

  return new Response(Bun.file(indexPath), {
    headers: responseHeaders(req),
  });
}

// ── Start ───────────────────────────────────────────────────────────

Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      const headers = corsHeaders(req);
      if (!headers) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/api/session" && req.method === "GET") {
      const origin = req.headers.get("origin");
      if (origin && !isAllowedOrigin(origin)) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!isLoopbackRequest(req) || !hasValidBootstrapToken(req)) {
        return jsonResponse(req, { error: "Forbidden" }, 403);
      }
      return jsonResponse(req, { ok: true }, 200, {
        "Set-Cookie": createSessionCookie(req),
      });
    }

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const origin = req.headers.get("origin");
      if (!isAllowedOrigin(origin)) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!isAuthorized(req)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined as unknown as Response;
    }

    if (url.pathname.startsWith("/api/")) {
      const authError = authorizeHttp(req);
      if (authError) {
        return jsonResponse(
          req,
          { error: authError.message },
          authError.status
        );
      }
    }

    // REST: compare
    if (
      url.pathname.startsWith("/api/projects/") &&
      url.pathname.endsWith("/compare")
    ) {
      const parts = url.pathname.split("/");
      const projectId = parts[3];
      const left = url.searchParams.get("left");
      const right = url.searchParams.get("right");
      if (!(left && right)) {
        return jsonResponse(req, { error: "left and right required" }, 400);
      }
      try {
        const compare = await service.compareSaves(projectId!, left, right);
        return jsonResponse(req, { compare });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: compute changes for a save (backfill)
    // e.g. /api/projects/:id/saves/:saveId/changes
    if (
      url.pathname.match(/^\/api\/projects\/[^/]+\/saves\/[^/]+\/changes$/) &&
      req.method === "POST"
    ) {
      const parts = url.pathname.split("/");
      const projectId = parts[3]!;
      const saveId = parts[5]!;
      try {
        const { changes } = await service.computeChanges(projectId, saveId);
        await broadcastSnapshot();
        return jsonResponse(req, { changes });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        return jsonResponse(req, { error: message }, status);
      }
    }

    if (
      url.pathname.match(
        /^\/api\/projects\/[^/]+\/saves\/[^/]+\/preview\/request$/
      ) &&
      req.method === "POST"
    ) {
      const parts = url.pathname.split("/");
      const projectId = parts[3]!;
      const saveId = parts[5]!;
      try {
        const preview = await service.requestPreview(projectId, saveId);
        await broadcastSnapshot();
        return jsonResponse(req, { preview });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        return jsonResponse(req, { error: message }, status);
      }
    }

    if (
      url.pathname.match(
        /^\/api\/projects\/[^/]+\/saves\/[^/]+\/preview\/reveal-folder$/
      ) &&
      req.method === "POST"
    ) {
      const parts = url.pathname.split("/");
      const projectId = parts[3]!;
      const saveId = parts[5]!;
      try {
        const preview = await service.revealPreviewFolder(projectId, saveId);
        return jsonResponse(req, { preview });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: upload preview audio file
    // POST /api/projects/:id/saves/:saveId/preview/upload (multipart)
    if (
      url.pathname.match(
        /^\/api\/projects\/[^/]+\/saves\/[^/]+\/preview\/upload$/
      ) &&
      req.method === "POST"
    ) {
      const parts = url.pathname.split("/");
      const projectId = parts[3]!;
      const saveId = parts[5]!;
      try {
        const formData = await req.formData();
        const file = formData.get("file");
        if (!(file && file instanceof File)) {
          return jsonResponse(req, { error: "file field required" }, 400);
        }
        if (file.size > MAX_PREVIEW_UPLOAD_BYTES) {
          return jsonResponse(
            req,
            {
              error: `file too large (max ${Math.floor(MAX_PREVIEW_UPLOAD_BYTES / (1024 * 1024))}MB)`,
            },
            413
          );
        }
        const fileData = await file.arrayBuffer();
        const preview = await service.uploadPreview(
          projectId,
          saveId,
          fileData,
          file.name
        );
        await broadcastSnapshot();
        return jsonResponse(req, { preview });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: cancel pending preview request
    // POST /api/projects/:id/saves/:saveId/preview/cancel
    if (
      url.pathname.match(
        /^\/api\/projects\/[^/]+\/saves\/[^/]+\/preview\/cancel$/
      ) &&
      req.method === "POST"
    ) {
      const parts = url.pathname.split("/");
      const projectId = parts[3]!;
      const saveId = parts[5]!;
      try {
        await service.cancelPreview(projectId, saveId);
        await broadcastSnapshot();
        return jsonResponse(req, { ok: true });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: list projects
    if (url.pathname === "/api/projects" && req.method === "GET") {
      const projects = await service.listProjects();
      return jsonResponse(req, { projects });
    }

    // REST: disk usage for a project
    // GET /api/projects/:id/disk-usage
    if (
      url.pathname.match(/^\/api\/projects\/[^/]+\/disk-usage$/) &&
      req.method === "GET"
    ) {
      const parts = url.pathname.split("/");
      const projectId = parts[3]!;
      try {
        const usage = await service.getDiskUsage(projectId);
        return jsonResponse(req, usage);
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: prune auto-saves older than N days
    // POST /api/projects/:id/prune  body: { olderThanDays: number }
    if (
      url.pathname.match(/^\/api\/projects\/[^/]+\/prune$/) &&
      req.method === "POST"
    ) {
      const parts = url.pathname.split("/");
      const projectId = parts[3]!;
      try {
        const body = (await req.json()) as { olderThanDays?: number };
        const days = body.olderThanDays;
        if (typeof days !== "number" || days < 0) {
          return jsonResponse(
            req,
            { error: "olderThanDays must be a non-negative number" },
            400
          );
        }
        const { deletedCount } = await service.pruneSaves(projectId, days);
        await broadcastSnapshot();
        return jsonResponse(req, { deletedCount });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: compact auto-saves using retention buckets
    // POST /api/projects/:id/compact-storage
    if (
      url.pathname.match(/^\/api\/projects\/[^/]+\/compact-storage$/) &&
      req.method === "POST"
    ) {
      const parts = url.pathname.split("/");
      const projectId = parts[3]!;
      try {
        const { project, deletedCount } =
          await service.compactStorage(projectId);
        await broadcastSnapshot();
        return jsonResponse(req, { project, deletedCount });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: media proxy
    if (url.pathname === "/api/media") {
      const p = url.searchParams.get("path");
      if (!p) {
        return jsonResponse(req, { error: "path required" }, 400);
      }
      try {
        const resolved = await service.resolvePreviewPath(p);
        return new Response(Bun.file(resolved), {
          headers: responseHeaders(req),
        });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 404;
        const message = err instanceof Error ? err.message : "File not found";
        return jsonResponse(req, { error: message }, status);
      }
    }

    const staticResponse = await serveStatic(req, url.pathname);
    if (staticResponse) {
      return staticResponse;
    }

    return new Response("Not found", {
      status: 404,
      headers: responseHeaders(req),
    });
  },

  websocket: {
    open(ws) {
      clients.add(ws);
      buildSnapshotEvent().then((snapshot) => {
        ws.send(JSON.stringify(snapshot satisfies WsEvent));
      });
    },
    async message(ws, raw) {
      try {
        const cmd = JSON.parse(String(raw)) as WsCommand;
        const result = await handleCommand(cmd);
        if (result) {
          broadcast(result);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const status = err instanceof AppError ? err.status : 500;
        ws.send(
          JSON.stringify({
            type: "error",
            message,
            status,
          } satisfies WsEvent & { status?: number })
        );
      }
    },
    close(ws) {
      clients.delete(ws);
    },
  },
});

console.log(`Echoform server running on http://localhost:${PORT}`);
