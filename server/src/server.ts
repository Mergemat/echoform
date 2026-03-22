import { AblegitService, AppError } from './core';
import { discoverProjects } from './discovery';
import { ProjectWatcher } from './watcher';
import type { WsCommand, WsEvent } from './types';

const PORT = Number(process.env.PORT || 3001);
const service = new AblegitService();
const clients = new Set<{ send: (data: string) => void }>();
const SESSION_COOKIE_NAME = 'ablegit_session';
const SESSION_TOKEN = crypto.randomUUID();
const DEFAULT_ALLOWED_ORIGINS = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
const allowedOrigins = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(process.env.ABLEGIT_ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) ?? []),
]);

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

function isAllowedOrigin(origin: string | null): origin is string {
  return origin !== null && allowedOrigins.has(origin);
}

function parseCookies(req: Request): Map<string, string> {
  const raw = req.headers.get('cookie');
  if (!raw) return new Map();
  return new Map(
    raw
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf('=');
        if (idx === -1) return [part, ''] as const;
        return [
          decodeURIComponent(part.slice(0, idx)),
          decodeURIComponent(part.slice(idx + 1)),
        ] as const;
      }),
  );
}

function isAuthorized(req: Request): boolean {
  return parseCookies(req).get(SESSION_COOKIE_NAME) === SESSION_TOKEN;
}

function createSessionCookie(req: Request): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(SESSION_TOKEN)}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

function responseHeaders(req: Request, extra: HeadersInit = {}): HeadersInit {
  const origin = req.headers.get('origin');
  if (isAllowedOrigin(origin)) {
    return { ...extra, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }
  return extra;
}

function corsHeaders(req: Request): HeadersInit | null {
  const origin = req.headers.get('origin');
  if (!isAllowedOrigin(origin)) return null;
  return responseHeaders(req, {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
}

function authorizeHttp(req: Request): AppError | null {
  const origin = req.headers.get('origin');
  if (origin && !isAllowedOrigin(origin)) {
    return new AppError('Forbidden', 403);
  }
  if (!isAuthorized(req)) {
    return new AppError('Unauthorized', 401);
  }
  return null;
}

// ── Watcher ─────────────────────────────────────────────────────────

const watcher = new ProjectWatcher({
  onChange: async (projectId, projectName) => {
    broadcast({ type: 'change-detected', projectId, projectName });
    // suppress watcher while saving to prevent infinite loop
    watcher.suppress(projectId);
    try {
      const { project, save } = await service.createSave(projectId, {
        auto: true,
      });
      if (save) {
        broadcast({ type: 'auto-saved', projectId, save });
        broadcast({ type: 'project-updated', project });
      }
      // if save is null, hash matched — no real changes, silently skip
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Auto-save failed';
      broadcast({ type: 'error', message: msg });
    } finally {
      watcher.unsuppress(projectId);
    }
  },
  onError: (projectId, _projectName, message) => {
    broadcast({ type: 'error', message });
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
    case 'track-project': {
      const project = await service.trackProject({
        name: cmd.name,
        projectPath: cmd.projectPath,
      });
      await watcher.watchProject(project);
      const projects = await service.listProjects();
      return { type: 'projects', projects };
    }
    case 'delete-project': {
      watcher.unwatchProject(cmd.projectId);
      const projects = await service.deleteProject(cmd.projectId);
      return { type: 'projects', projects };
    }
    case 'create-save': {
      const result = await service.createSave(cmd.projectId, {
        label: cmd.label,
        note: cmd.note,
      });
      return { type: 'project-updated', project: result.project };
    }
    case 'create-idea': {
      const project = await service.createIdea(cmd.projectId, {
        fromSaveId: cmd.fromSaveId,
        name: cmd.name,
      });
      return { type: 'project-updated', project };
    }
    case 'go-back-to': {
      watcher.suppress(cmd.projectId);
      try {
        const project = await service.goBackTo(cmd.projectId, {
          saveId: cmd.saveId,
          force: cmd.force,
        });
        return { type: 'project-updated', project };
      } finally {
        watcher.unsuppress(cmd.projectId);
      }
    }
    case 'compare': {
      // compare returns via HTTP for simplicity
      return null;
    }
    case 'update-save': {
      const project = await service.updateSave(cmd.projectId, cmd.saveId, {
        note: cmd.note,
        label: cmd.label,
      });
      return { type: 'project-updated', project };
    }
    case 'discover-projects': {
      const tracked = await service.listProjects();
      const paths = await discoverProjects(tracked);
      return { type: 'discovered-projects', paths };
    }
    case 'toggle-watching': {
      if (cmd.watching) {
        // Watch first — only persist if the watcher starts successfully
        const state = await service.loadState();
        const project = state.projects.find((p) => p.id === cmd.projectId);
        if (!project) return { type: 'error', message: 'Project not found' };
        await watcher.watchProject(project);
        const updated = await service.toggleWatching(cmd.projectId, true);
        return { type: 'project-updated', project: updated };
      } else {
        watcher.unwatchProject(cmd.projectId);
        const updated = await service.toggleWatching(cmd.projectId, false);
        return { type: 'project-updated', project: updated };
      }
    }
    case 'delete-save': {
      const project = await service.deleteSave(cmd.projectId, cmd.saveId);
      return { type: 'project-updated', project };
    }
  }
}

// ── HTTP routes (compare + media) ───────────────────────────────────

function jsonResponse(
  req: Request,
  data: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(req, {
      'Content-Type': 'application/json',
      ...extraHeaders,
    }),
  });
}

// ── Start ───────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      const headers = corsHeaders(req);
      if (!headers) return new Response('Forbidden', { status: 403 });
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/api/session' && req.method === 'GET') {
      const origin = req.headers.get('origin');
      if (origin && !isAllowedOrigin(origin)) {
        return new Response('Forbidden', { status: 403 });
      }
      return jsonResponse(req, { ok: true }, 200, {
        'Set-Cookie': createSessionCookie(req),
      });
    }

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const origin = req.headers.get('origin');
      if (!isAllowedOrigin(origin))
        return new Response('Forbidden', { status: 403 });
      if (!isAuthorized(req))
        return new Response('Unauthorized', { status: 401 });
      const upgraded = server.upgrade(req);
      if (!upgraded)
        return new Response('WebSocket upgrade failed', { status: 400 });
      return undefined as unknown as Response;
    }

    if (url.pathname.startsWith('/api/')) {
      const authError = authorizeHttp(req);
      if (authError) {
        return jsonResponse(
          req,
          { error: authError.message },
          authError.status,
        );
      }
    }

    // REST: compare
    if (
      url.pathname.startsWith('/api/projects/') &&
      url.pathname.endsWith('/compare')
    ) {
      const parts = url.pathname.split('/');
      const projectId = parts[3];
      const left = url.searchParams.get('left');
      const right = url.searchParams.get('right');
      if (!left || !right)
        return jsonResponse(req, { error: 'left and right required' }, 400);
      try {
        const compare = await service.compareSaves(projectId!, left, right);
        return jsonResponse(req, { compare });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : 'Unknown error';
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: compute changes for a save (backfill)
    // e.g. /api/projects/:id/saves/:saveId/changes
    if (
      url.pathname.match(/^\/api\/projects\/[^/]+\/saves\/[^/]+\/changes$/) &&
      req.method === 'POST'
    ) {
      const parts = url.pathname.split('/');
      const projectId = parts[3]!;
      const saveId = parts[5]!;
      try {
        const { project, changes } = await service.computeChanges(
          projectId,
          saveId,
        );
        broadcast({ type: 'project-updated', project });
        return jsonResponse(req, { changes });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : 'Unknown error';
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: list smart-restore track candidates for a save
    // GET /api/projects/:id/saves/:saveId/smart-restore/tracks
    if (
      url.pathname.match(
        /^\/api\/projects\/[^/]+\/saves\/[^/]+\/smart-restore\/tracks$/,
      ) &&
      req.method === 'GET'
    ) {
      const parts = url.pathname.split('/');
      const projectId = parts[3]!;
      const saveId = parts[5]!;
      try {
        const tracks = await service.listSmartRestoreTracks(projectId, saveId);
        return jsonResponse(req, { tracks });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : 'Unknown error';
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: smart-restore selected tracks from a save into active set
    // POST /api/projects/:id/saves/:saveId/smart-restore  body: { trackIds: string[] }
    if (
      url.pathname.match(
        /^\/api\/projects\/[^/]+\/saves\/[^/]+\/smart-restore$/,
      ) &&
      req.method === 'POST'
    ) {
      const parts = url.pathname.split('/');
      const projectId = parts[3]!;
      const saveId = parts[5]!;
      try {
        const body = (await req.json()) as { trackIds?: string[] };
        if (!Array.isArray(body.trackIds) || body.trackIds.length === 0) {
          return jsonResponse(
            req,
            { error: 'trackIds must be a non-empty array' },
            400,
          );
        }
        const result = await service.smartRestore(
          projectId,
          saveId,
          body.trackIds,
        );
        return jsonResponse(req, { result });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : 'Unknown error';
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: list projects
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      const projects = await service.listProjects();
      return jsonResponse(req, { projects });
    }

    // REST: disk usage for a project
    // GET /api/projects/:id/disk-usage
    if (
      url.pathname.match(/^\/api\/projects\/[^/]+\/disk-usage$/) &&
      req.method === 'GET'
    ) {
      const parts = url.pathname.split('/');
      const projectId = parts[3]!;
      try {
        const usage = await service.getDiskUsage(projectId);
        return jsonResponse(req, usage);
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : 'Unknown error';
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: prune auto-saves older than N days
    // POST /api/projects/:id/prune  body: { olderThanDays: number }
    if (
      url.pathname.match(/^\/api\/projects\/[^/]+\/prune$/) &&
      req.method === 'POST'
    ) {
      const parts = url.pathname.split('/');
      const projectId = parts[3]!;
      try {
        const body = (await req.json()) as { olderThanDays?: number };
        const days = body.olderThanDays;
        if (typeof days !== 'number' || days < 0) {
          return jsonResponse(
            req,
            { error: 'olderThanDays must be a non-negative number' },
            400,
          );
        }
        const { project, deletedCount } = await service.pruneSaves(
          projectId,
          days,
        );
        broadcast({ type: 'project-updated', project });
        return jsonResponse(req, { deletedCount });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        const message = err instanceof Error ? err.message : 'Unknown error';
        return jsonResponse(req, { error: message }, status);
      }
    }

    // REST: media proxy
    if (url.pathname === '/api/media') {
      const p = url.searchParams.get('path');
      if (!p) return jsonResponse(req, { error: 'path required' }, 400);
      try {
        const resolved = await service.resolvePreviewPath(p);
        return new Response(Bun.file(resolved), {
          headers: responseHeaders(req),
        });
      } catch (err) {
        const status = err instanceof AppError ? err.status : 404;
        const message = err instanceof Error ? err.message : 'File not found';
        return jsonResponse(req, { error: message }, status);
      }
    }

    return new Response('Not found', {
      status: 404,
      headers: responseHeaders(req),
    });
  },

  websocket: {
    open(ws) {
      clients.add(ws);
      // send initial state
      service.listProjects().then((projects) => {
        ws.send(
          JSON.stringify({ type: 'projects', projects } satisfies WsEvent),
        );
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
        const message = err instanceof Error ? err.message : 'Unknown error';
        const status = err instanceof AppError ? err.status : 500;
        ws.send(
          JSON.stringify({
            type: 'error',
            message,
            status,
          } satisfies WsEvent & { status?: number }),
        );
      }
    },
    close(ws) {
      clients.delete(ws);
    },
  },
});

console.log(`Ablegit server running on http://localhost:${PORT}`);
