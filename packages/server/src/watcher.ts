import { type FSWatcher, watch } from "node:fs";
import type { Project, TrackedRoot } from "./types";

interface WatcherEvents {
  onChange: (
    projectId: string,
    projectName: string,
    changedPaths: string[]
  ) => void;
  onError: (projectId: string, projectName: string, message: string) => void;
}

interface RootWatcherEvents {
  onChange: (rootId: string, rootName: string) => void;
  onError: (rootId: string, rootName: string, message: string) => void;
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
  private readonly debounceTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly pendingChangedPaths = new Map<string, Set<string>>();
  private readonly suppressedProjects = new Set<string>();
  private readonly events: WatcherEvents;
  private readonly debounceMs: number;

  constructor(events: WatcherEvents, debounceMs = DEFAULT_WATCHER_DEBOUNCE_MS) {
    this.events = events;
    this.debounceMs = debounceMs;
  }

  /** Temporarily ignore FS events for a project (call during save) */
  suppress(projectId: string): void {
    this.suppressedProjects.add(projectId);
  }

  /** Re-enable FS events after a cooldown so the copy's own events drain */
  unsuppress(projectId: string, cooldownMs = 2000): void {
    setTimeout(() => this.suppressedProjects.delete(projectId), cooldownMs);
  }

  async watchProject(project: Project): Promise<void> {
    if (this.watchers.has(project.id)) {
      return;
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
            return;
          }
          this.debouncedChange(project.id, project.name, filename);
        }
      );
      watcher.on("error", (err: NodeJS.ErrnoException) => {
        const msg = watchErrorMessage(err);
        this.events.onError(project.id, project.name, msg);
        this.unwatchProject(project.id);
      });
      this.watchers.set(project.id, watcher);
    } catch (err) {
      const msg = watchErrorMessage(err);
      this.events.onError(project.id, project.name, msg);
    }
  }

  unwatchProject(projectId: string): void {
    const w = this.watchers.get(projectId);
    if (w) {
      w.close();
      this.watchers.delete(projectId);
    }
    const t = this.debounceTimers.get(projectId);
    if (t) {
      clearTimeout(t);
      this.debounceTimers.delete(projectId);
    }
    this.pendingChangedPaths.delete(projectId);
    this.suppressedProjects.delete(projectId);
  }

  unwatchAll(): void {
    for (const [id] of this.watchers) {
      this.unwatchProject(id);
    }
  }

  private debouncedChange(
    projectId: string,
    projectName: string,
    changedPath: string
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
      this.events.onChange(projectId, projectName, changedPaths);
    }, this.debounceMs);
    this.debounceTimers.set(projectId, timer);
  }

  isWatching(projectId: string): boolean {
    return this.watchers.has(projectId);
  }
}

export class RootWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly debounceTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly events: RootWatcherEvents;
  private readonly debounceMs: number;

  constructor(
    events: RootWatcherEvents,
    debounceMs = DEFAULT_WATCHER_DEBOUNCE_MS
  ) {
    this.events = events;
    this.debounceMs = debounceMs;
  }

  async watchRoot(root: TrackedRoot): Promise<void> {
    if (this.watchers.has(root.id)) {
      return;
    }

    try {
      const watcher = watch(root.path, { recursive: true }, () => {
        this.debouncedChange(root.id, root.name);
      });
      watcher.on("error", (err: NodeJS.ErrnoException) => {
        const msg = watchErrorMessage(err);
        this.events.onError(root.id, root.name, msg);
        this.unwatchRoot(root.id);
      });
      this.watchers.set(root.id, watcher);
    } catch (err) {
      const msg = watchErrorMessage(err);
      this.events.onError(root.id, root.name, msg);
    }
  }

  unwatchRoot(rootId: string): void {
    const watcher = this.watchers.get(rootId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(rootId);
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

  private debouncedChange(rootId: string, rootName: string): void {
    const existing = this.debounceTimers.get(rootId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(rootId);
      this.events.onChange(rootId, rootName);
    }, this.debounceMs);
    this.debounceTimers.set(rootId, timer);
  }
}
