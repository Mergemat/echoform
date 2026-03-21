import { watch, type FSWatcher } from 'node:fs';
import type { Project } from './types';

type WatcherEvents = {
  onChange: (projectId: string, projectName: string) => void;
  onError: (projectId: string, projectName: string, message: string) => void;
};

function watchErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as NodeJS.ErrnoException).code;
    switch (code) {
      case 'EACCES':
        return 'Permission denied — cannot watch this project folder. Check file permissions.';
      case 'ENOENT':
        return 'Project folder not found — it may have been moved or deleted.';
      case 'EMFILE':
        return 'Too many open files — close some applications or increase the system limit.';
      case 'ENOSPC':
        return 'No space for file watchers — too many files are being watched system-wide.';
      default:
        return `File watcher error (${code}): ${err instanceof Error ? err.message : 'unknown'}`;
    }
  }
  return 'File watcher encountered an unexpected error.';
}

export class ProjectWatcher {
  private watchers = new Map<string, FSWatcher>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private suppressedProjects = new Set<string>();
  private events: WatcherEvents;
  private debounceMs: number;

  constructor(events: WatcherEvents, debounceMs = 3000) {
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
    if (this.watchers.has(project.id)) return;
    if (!project.watching) return;

    try {
      const watcher = watch(
        project.projectPath,
        { recursive: true },
        (_event, filename) => {
          if (!filename) return;
          if (!filename.toLowerCase().endsWith('.als')) return;
          if (filename.startsWith('Backup/') || filename.startsWith('Backup\\'))
            return;
          if (this.suppressedProjects.has(project.id)) return;
          this.debouncedChange(project.id, project.name);
        },
      );
      watcher.on('error', (err: NodeJS.ErrnoException) => {
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
    this.suppressedProjects.delete(projectId);
  }

  unwatchAll(): void {
    for (const [id] of this.watchers) this.unwatchProject(id);
  }

  private debouncedChange(projectId: string, projectName: string): void {
    const existing = this.debounceTimers.get(projectId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(projectId);
      this.events.onChange(projectId, projectName);
    }, this.debounceMs);
    this.debounceTimers.set(projectId, timer);
  }

  isWatching(projectId: string): boolean {
    return this.watchers.has(projectId);
  }
}
