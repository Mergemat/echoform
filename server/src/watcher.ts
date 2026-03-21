import { watch, type FSWatcher } from 'node:fs';
import type { Project } from './types';

type WatcherEvents = {
  onChange: (projectId: string, projectName: string) => void;
};

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
      this.watchers.set(project.id, watcher);
    } catch {
      // watch may fail on some filesystems, silently skip
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
