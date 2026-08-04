import { type FSWatcher, watch } from "node:fs";
import type { Project, TrackedRoot } from "./types";

interface WatcherEvents {
  onChange: (
    projectId: string,
    projectName: string,
    changedPaths: string[],
  ) => void | Promise<void>;
  onError: (
    projectId: string,
    projectName: string,
    message: string,
  ) => void | Promise<void>;
}

interface RootWatcherEvents {
  onChange: (rootId: string, rootName: string) => void | Promise<void>;
  onError: (
    rootId: string,
    rootName: string,
    message: string,
  ) => void | Promise<void>;
}

export const DEFAULT_WATCHER_DEBOUNCE_MS = 200;

function watchErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as NodeJS.ErrnoException).code;
    switch (code) {
      case "EACCES":
        return "Permission denied — cannot watch this project folder. Check file permissions.";
      case "ENOENT":
        return "Project folder not found — it may have been moved or deleted.";
      case "EMFILE":
        return "Too many open files — close some applications or increase the system limit.";
      case "ENOSPC":
        return "No space for file watchers — too many files are being watched system-wide.";
      default:
        return `File watcher error (${code}): ${err instanceof Error ? err.message : "unknown"}`;
    }
  }
  return "File watcher encountered an unexpected error.";
}

export class ProjectWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly watchedPaths = new Map<string, string>();
  private readonly debounceTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly pendingChangedPaths = new Map<string, Set<string>>();
  private readonly suppressedProjects = new Set<string>();
  private readonly suppressedChanges = new Map<
    string,
    { projectName: string; paths: Set<string> }
  >();
  private readonly suppressionTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly events: WatcherEvents;
  private readonly debounceMs: number;

  constructor(events: WatcherEvents, debounceMs = DEFAULT_WATCHER_DEBOUNCE_MS) {
    this.events = events;
    this.debounceMs = debounceMs;
  }

  /** Temporarily ignore FS events for a project (call during save) */
  suppress(projectId: string): void {
    const timer = this.suppressionTimers.get(projectId);
    if (timer) {
      clearTimeout(timer);
      this.suppressionTimers.delete(projectId);
    }
    this.suppressedProjects.add(projectId);
  }

  /** Re-enable FS events after a cooldown so the copy's own events drain */
  unsuppress(projectId: string, cooldownMs = 2000): void {
    const existing = this.suppressionTimers.get(projectId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.suppressionTimers.delete(projectId);
      this.suppressedProjects.delete(projectId);
      const queued = this.suppressedChanges.get(projectId);
      this.suppressedChanges.delete(projectId);
      if (!queued) {
        return;
      }
      for (const path of queued.paths) {
        this.debouncedChange(projectId, queued.projectName, path);
      }
    }, cooldownMs);
    this.suppressionTimers.set(projectId, timer);
  }

  async watchProject(project: Project): Promise<void> {
    if (this.watchers.has(project.id)) {
      if (this.watchedPaths.get(project.id) === project.projectPath) {
        return;
      }
      this.unwatchProject(project.id);
    }
    if (!project.watching) {
      return;
    }
    if (project.presence !== "active") {
      return;
    }

    try {
      const watcher = watch(
        project.projectPath,
        { recursive: true },
        (_event, filename) => {
          if (!filename) {
            return;
          }
          if (!filename.toLowerCase().endsWith(".als")) {
            return;
          }
          if (
            filename.startsWith("Backup/") ||
            filename.startsWith("Backup\\")
          ) {
            return;
          }
          if (this.suppressedProjects.has(project.id)) {
            const queued = this.suppressedChanges.get(project.id) ?? {
              projectName: project.name,
              paths: new Set<string>(),
            };
            queued.paths.add(filename);
            this.suppressedChanges.set(project.id, queued);
            return;
          }
          this.debouncedChange(project.id, project.name, filename);
        },
      );
      watcher.on("error", (err: NodeJS.ErrnoException) => {
        const msg = watchErrorMessage(err);
        void Promise.resolve(
          this.events.onError(project.id, project.name, msg),
        ).catch(() => {});
        this.unwatchProject(project.id);
      });
      this.watchers.set(project.id, watcher);
      this.watchedPaths.set(project.id, project.projectPath);
    } catch (err) {
      const msg = watchErrorMessage(err);
      await this.events.onError(project.id, project.name, msg);
    }
  }

  unwatchProject(projectId: string): void {
    const w = this.watchers.get(projectId);
    if (w) {
      w.close();
      this.watchers.delete(projectId);
      this.watchedPaths.delete(projectId);
    }
    const t = this.debounceTimers.get(projectId);
    if (t) {
      clearTimeout(t);
      this.debounceTimers.delete(projectId);
    }
    this.pendingChangedPaths.delete(projectId);
    this.suppressedProjects.delete(projectId);
    this.suppressedChanges.delete(projectId);
    const suppressionTimer = this.suppressionTimers.get(projectId);
    if (suppressionTimer) {
      clearTimeout(suppressionTimer);
      this.suppressionTimers.delete(projectId);
    }
  }

  unwatchAll(): void {
    for (const [id] of this.watchers) {
      this.unwatchProject(id);
    }
  }

  private debouncedChange(
    projectId: string,
    projectName: string,
    changedPath: string,
  ): void {
    const pending =
      this.pendingChangedPaths.get(projectId) ?? new Set<string>();
    pending.add(changedPath);
    this.pendingChangedPaths.set(projectId, pending);

    const existing = this.debounceTimers.get(projectId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(projectId);
      const changedPaths = [
        ...(this.pendingChangedPaths.get(projectId) ?? new Set<string>()),
      ];
      this.pendingChangedPaths.delete(projectId);
      void Promise.resolve(
        this.events.onChange(projectId, projectName, changedPaths),
      )
        .catch((error) =>
          this.events.onError(
            projectId,
            projectName,
            error instanceof Error ? error.message : "Watcher callback failed.",
          ),
        )
        .catch(() => {});
    }, this.debounceMs);
    this.debounceTimers.set(projectId, timer);
  }

  isWatching(projectId: string): boolean {
    return this.watchers.has(projectId);
  }

  watchedProjectIds(): string[] {
    return [...this.watchers.keys()];
  }
}

export class RootWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly watchedPaths = new Map<string, string>();
  private readonly debounceTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly events: RootWatcherEvents;
  private readonly debounceMs: number;

  constructor(
    events: RootWatcherEvents,
    debounceMs = DEFAULT_WATCHER_DEBOUNCE_MS,
  ) {
    this.events = events;
    this.debounceMs = debounceMs;
  }

  async watchRoot(root: TrackedRoot): Promise<void> {
    if (this.watchers.has(root.id)) {
      if (this.watchedPaths.get(root.id) === root.path) {
        return;
      }
      this.unwatchRoot(root.id);
    }

    try {
      const watcher = watch(root.path, { recursive: true }, () => {
        this.debouncedChange(root.id, root.name);
      });
      watcher.on("error", (err: NodeJS.ErrnoException) => {
        const msg = watchErrorMessage(err);
        void Promise.resolve(
          this.events.onError(root.id, root.name, msg),
        ).catch(() => {});
        this.unwatchRoot(root.id);
      });
      this.watchers.set(root.id, watcher);
      this.watchedPaths.set(root.id, root.path);
    } catch (err) {
      const msg = watchErrorMessage(err);
      await this.events.onError(root.id, root.name, msg);
    }
  }

  unwatchRoot(rootId: string): void {
    const watcher = this.watchers.get(rootId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(rootId);
      this.watchedPaths.delete(rootId);
    }
    const timer = this.debounceTimers.get(rootId);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(rootId);
    }
  }

  unwatchAll(): void {
    for (const [id] of this.watchers) {
      this.unwatchRoot(id);
    }
  }

  watchedRootIds(): string[] {
    return [...this.watchers.keys()];
  }

  private debouncedChange(rootId: string, rootName: string): void {
    const existing = this.debounceTimers.get(rootId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(rootId);
      void Promise.resolve(this.events.onChange(rootId, rootName))
        .catch((error) =>
          this.events.onError(
            rootId,
            rootName,
            error instanceof Error
              ? error.message
              : "Root watcher callback failed.",
          ),
        )
        .catch(() => {});
    }, this.debounceMs);
    this.debounceTimers.set(rootId, timer);
  }
}
