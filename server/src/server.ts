import { AblegitService, AppError } from "./core";
import { discoverProjects } from "./discovery";
import { ProjectWatcher } from "./watcher";
import type { WsCommand, WsEvent } from "./types";

const PORT = Number(process.env.PORT || 3001);
const service = new AblegitService();
const clients = new Set<{ send: (data: string) => void }>();

function broadcast(event: WsEvent) {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    try { ws.send(data); } catch { clients.delete(ws); }
  }
}

// ── Watcher ─────────────────────────────────────────────────────────

const watcher = new ProjectWatcher({
  onChange: async (projectId, projectName) => {
    broadcast({ type: "change-detected", projectId, projectName });
    try {
      // suppress watcher while saving to prevent infinite loop
      watcher.suppress(projectId);
      const { project, save } = await service.createSave(projectId, { auto: true });
      watcher.unsuppress(projectId);
      if (save) {
        broadcast({ type: "auto-saved", projectId, save });
        broadcast({ type: "project-updated", project });
      }
      // if save is null, hash matched — no real changes, silently skip
    } catch (err) {
      watcher.unsuppress(projectId);
      const msg = err instanceof Error ? err.message : "Auto-save failed";
      broadcast({ type: "error", message: msg });
    }
  },
});

// start watching all tracked projects on boot
(async () => {
  const projects = await service.listProjects();
  for (const p of projects) {
    if (p.watching) await watcher.watchProject(p);
  }
})();

// ── WebSocket command handler ───────────────────────────────────────

async function handleCommand(cmd: WsCommand): Promise<WsEvent | null> {
  switch (cmd.type) {
    case "track-project": {
      const project = await service.trackProject({ name: cmd.name, projectPath: cmd.projectPath });
      await watcher.watchProject(project);
      const projects = await service.listProjects();
      return { type: "projects", projects };
    }
    case "create-save": {
      const result = await service.createSave(cmd.projectId, { label: cmd.label, note: cmd.note });
      return { type: "project-updated", project: result.project };
    }
    case "create-idea": {
      const project = await service.createIdea(cmd.projectId, { fromSaveId: cmd.fromSaveId, name: cmd.name });
      return { type: "project-updated", project };
    }
    case "go-back-to": {
      const project = await service.goBackTo(cmd.projectId, { saveId: cmd.saveId, force: cmd.force });
      return { type: "project-updated", project };
    }
    case "compare": {
      // compare returns via HTTP for simplicity
      return null;
    }
    case "update-save": {
      const project = await service.updateSave(cmd.projectId, cmd.saveId, { note: cmd.note, label: cmd.label });
      return { type: "project-updated", project };
    }
    case "discover-projects": {
      const tracked = await service.listProjects();
      const paths = await discoverProjects(tracked);
      return { type: "discovered-projects", paths };
    }
    case "toggle-watching": {
      const state = await service.loadState();
      const project = state.projects.find((p) => p.id === cmd.projectId);
      if (!project) return { type: "error", message: "Project not found" };
      project.watching = cmd.watching;
      if (cmd.watching) await watcher.watchProject(project);
      else watcher.unwatchProject(project.id);
      return { type: "project-updated", project };
    }
    case "delete-save": {
      const project = await service.deleteSave(cmd.projectId, cmd.saveId);
      return { type: "project-updated", project };
    }
  }
}

// ── HTTP routes (compare + media) ───────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// ── Start ───────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined as unknown as Response;
    }

    // REST: compare
    if (url.pathname.startsWith("/api/projects/") && url.pathname.endsWith("/compare")) {
      const parts = url.pathname.split("/");
      const projectId = parts[3];
      const left = url.searchParams.get("left");
      const right = url.searchParams.get("right");
      if (!left || !right) return jsonResponse({ error: "left and right required" }, 400);
      try {
        const compare = await service.compareSaves(projectId!, left, right);
        return jsonResponse({ compare });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        return jsonResponse({ error: message }, status);
      }
    }

    // REST: compute changes for a save (backfill)
    // e.g. /api/projects/:id/saves/:saveId/changes
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/saves\/[^/]+\/changes$/) && req.method === "POST") {
      const parts = url.pathname.split("/");
      const projectId = parts[3]!;
      const saveId = parts[5]!;
      try {
        const { project, changes } = await service.computeChanges(projectId, saveId);
        broadcast({ type: "project-updated", project });
        return jsonResponse({ changes });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        return jsonResponse({ error: message }, status);
      }
    }

    // REST: list projects
    if (url.pathname === "/api/projects" && req.method === "GET") {
      const projects = await service.listProjects();
      return jsonResponse({ projects });
    }

    // REST: media proxy
    if (url.pathname === "/api/media") {
      const p = url.searchParams.get("path");
      if (!p) return jsonResponse({ error: "path required" }, 400);
      try {
        const resolved = await service.resolvePreviewPath(p);
        return new Response(Bun.file(resolved), { headers: { "Access-Control-Allow-Origin": "*" } });
      } catch {
        return jsonResponse({ error: "File not found" }, 404);
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders() });
  },

  websocket: {
    open(ws) {
      clients.add(ws);
      // send initial state
      service.listProjects().then((projects) => {
        ws.send(JSON.stringify({ type: "projects", projects } satisfies WsEvent));
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
        ws.send(JSON.stringify({ type: "error", message, status } satisfies WsEvent & { status?: number }));
      }
    },
    close(ws) {
      clients.delete(ws);
    },
  },
});

console.log(`Ablegit server running on http://localhost:${PORT}`);
