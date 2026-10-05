import { basename, extname } from "@/lib/path";
import type { Idea, Project, Save } from "@/lib/types";

/** Display name for an Ableton set file (filename without extension). */
export function fileTabName(idea: Idea): string {
  const name = basename(idea.setPath);
  const ext = extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

// ── Formatters ───────────────────────────────────────────────────────
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
}

/** "Today", "Yesterday", "Monday", or "3 Oct" / "3 Oct 2025" for older days. */
export function formatDayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diffDays = Math.round(
    (startOfDay(now) - startOfDay(date)) / 86_400_000
  );
  if (diffDays === 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (diffDays > 1 && diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    weekday: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function formatFullDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
}

export function formatSizeDelta(bytes: number): string {
  const abs = Math.abs(bytes);
  const sign = bytes >= 0 ? "+" : "\u2212";
  if (abs < 1024) {
    return `${sign}${abs}B`;
  }
  if (abs < 1024 * 1024) {
    return `${sign}${(abs / 1024).toFixed(0)}K`;
  }
  return `${sign}${(abs / 1024 / 1024).toFixed(1)}M`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  const time = formatTime(iso);

  if (diffDays === 0) {
    return `Today ${time}`;
  }
  if (diffDays === 1) {
    return `Yesterday ${time}`;
  }
  if (diffDays < 7) {
    const day = d.toLocaleDateString(undefined, { weekday: "long" });
    return `${day} ${time}`;
  }
  return `${d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })} ${time}`;
}

function formatSaveTitle(iso: string, options?: { compact?: boolean }): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: options?.compact ? undefined : "numeric",
  });
}

export function getSaveDisplayTitle(
  save: { label: string; createdAt: string; customLabel?: boolean },
  options?: { compact?: boolean }
): string {
  if (save.customLabel && save.label.trim()) {
    return save.label.trim();
  }
  return formatSaveTitle(save.createdAt, options);
}

// ── File-type helpers ────────────────────────────────────────────────
const AUDIO_EXT = new Set([
  ".aif",
  ".aiff",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".wav",
]);

export function isAudio(p: string) {
  return AUDIO_EXT.has(extname(p).toLowerCase());
}

export function isAls(p: string) {
  return extname(p).toLowerCase() === ".als";
}

// ── Retention ────────────────────────────────────────────────────────

/**
 * Why a checkpoint is never removed by automatic cleanup. Mirrors
 * getProtectedSaveIds and the `save.auto` filter in
 * packages/server/src/core.ts — keep them in sync.
 */
export function getKeepReasons(project: Project, save: Save): string[] {
  const reasons: string[] = [];
  if (project.ideas.some((idea) => idea.headSaveId === save.id)) {
    reasons.push("latest save");
  }
  if (project.ideas.some((idea) => idea.baseSaveId === save.id)) {
    reasons.push("first save");
  }
  if (!save.auto) {
    // Cleanup only ever removes automatic checkpoints.
    reasons.push("created by Echoform");
  }
  if (save.pinned) {
    reasons.push("pinned");
  }
  if (save.customLabel) {
    reasons.push("named");
  }
  if (save.note.trim().length > 0) {
    reasons.push("has a note");
  }
  if (save.previewRefs.length > 0 || save.previewStatus === "pending") {
    reasons.push("has a preview");
  }
  return reasons;
}

// ── Grouping ─────────────────────────────────────────────────────────

export type DisplayItem =
  | { type: "save"; save: Save; grouped?: boolean }
  | { type: "group"; saves: Save[]; key: string; expanded: boolean };

/**
 * A save is "quiet" when analysis found no musical change at all (Live was
 * saved, nothing in the song moved). Runs of quiet saves collapse into one
 * row. Anything the user cares about (named, noted, pinned, previewed,
 * latest, first) is never quiet, so it is never hidden.
 */
function isQuietSave(save: Save, keep: (save: Save) => boolean): boolean {
  return save.auto && !keep(save) && save.summary?.weight === "none";
}

function buildDisplayItems(
  saves: Save[],
  expandedGroups: Set<string>,
  keep: (save: Save) => boolean
): DisplayItem[] {
  const items: DisplayItem[] = [];
  let i = 0;
  while (i < saves.length) {
    const save = saves[i]!;
    if (isQuietSave(save, keep)) {
      const group: Save[] = [save];
      let j = i + 1;
      while (j < saves.length && isQuietSave(saves[j]!, keep)) {
        group.push(saves[j]!);
        j++;
      }
      if (group.length >= 2) {
        const key = group[0]!.id;
        const expanded = expandedGroups.has(key);
        items.push({ expanded, key, saves: group, type: "group" });
        if (expanded) {
          for (const s of group) {
            items.push({ grouped: true, save: s, type: "save" });
          }
        }
        i = j;
        continue;
      }
    }
    items.push({ save, type: "save" });
    i++;
  }
  return items;
}

export interface TimelineSection {
  items: DisplayItem[];
  key: string;
  label: string;
}

function resolveIdea(project: Project, focusedIdeaId: string | null) {
  return (
    project.ideas.find(
      (candidate) => candidate.id === (focusedIdeaId ?? project.currentIdeaId)
    ) ?? project.ideas[0]
  );
}

function ideaSavesNewestFirst(project: Project, idea: Idea): Save[] {
  return project.saves
    .filter((save) => save.ideaId === idea.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The focused set's checkpoints, newest first, split into calendar days. */
export function buildTimelineSections(
  project: Project,
  focusedIdeaId: string | null,
  expandedGroups: Set<string>,
  now = new Date()
): TimelineSection[] {
  const idea = resolveIdea(project, focusedIdeaId);
  if (!idea) {
    return [];
  }
  const keep = (save: Save) => getKeepReasons(project, save).length > 0;

  const days = new Map<string, Save[]>();
  for (const save of ideaSavesNewestFirst(project, idea)) {
    const d = new Date(save.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const bucket = days.get(key);
    if (bucket) {
      bucket.push(save);
    } else {
      days.set(key, [save]);
    }
  }

  return [...days].map(([key, saves]) => ({
    items: buildDisplayItems(saves, expandedGroups, keep),
    key,
    label: formatDayLabel(saves[0]!.createdAt, now),
  }));
}

type TimelineDisplayItem = DisplayItem & { idea: Idea };

export function buildTimelineDisplayItems(
  project: Project,
  focusedIdeaId: string | null,
  expandedGroups: Set<string>
): TimelineDisplayItem[] {
  const idea = resolveIdea(project, focusedIdeaId);
  if (!idea) {
    return [];
  }
  return buildTimelineSections(project, idea.id, expandedGroups).flatMap(
    (section) => section.items.map((item) => ({ ...item, idea }))
  );
}
