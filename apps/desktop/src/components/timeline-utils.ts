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

// ── Chip builders ────────────────────────────────────────────────────
export interface Chip {
  kind: "neutral" | "add" | "remove" | "change";
  label: string;
}

export function buildChips(save: Save): Chip[] {
  const chips: Chip[] = [];
  const sd = save.setDiff;
  if (sd) {
    if (sd.tempoChange) {
      chips.push({
        kind: "change",
        label: `${sd.tempoChange.from}\u2192${sd.tempoChange.to} bpm`,
      });
    }
    if (sd.timeSignatureChange) {
      chips.push({
        kind: "change",
        label: `${sd.timeSignatureChange.from}\u2192${sd.timeSignatureChange.to}`,
      });
    }
    const addByType: Record<string, number> = {};
    const remByType: Record<string, number> = {};
    for (const t of sd.addedTracks) {
      addByType[t.type] = (addByType[t.type] ?? 0) + 1;
    }
    for (const t of sd.removedTracks) {
      remByType[t.type] = (remByType[t.type] ?? 0) + 1;
    }
    const TL: Record<string, string> = {
      audio: "Audio",
      group: "Group",
      midi: "MIDI",
      return: "Return",
    };
    for (const [type, count] of Object.entries(addByType)) {
      chips.push({ kind: "add", label: `+${count} ${TL[type] ?? type}` });
    }
    for (const [type, count] of Object.entries(remByType)) {
      chips.push({
        kind: "remove",
        label: `\u2212${count} ${TL[type] ?? type}`,
      });
    }
    const renames = sd.modifiedTracks.filter((t) => t.renamedFrom);
    if (renames.length === 1) {
      chips.push({
        kind: "change",
        label: `\u201c${renames[0]?.renamedFrom}\u201d\u2192\u201c${renames[0]?.name}\u201d`,
      });
    } else if (renames.length >= 2) {
      chips.push({ kind: "change", label: `${renames.length} tracks renamed` });
    }
    let totalDeviceAdds = 0;
    let totalDeviceRemoves = 0;
    for (const t of sd.modifiedTracks) {
      totalDeviceAdds += t.addedDevices.length;
      totalDeviceRemoves += t.removedDevices.length;
    }
    const deviceDelta = totalDeviceAdds - totalDeviceRemoves;
    if (deviceDelta !== 0) {
      chips.push({
        kind: deviceDelta > 0 ? "add" : "remove",
        label: `${deviceDelta > 0 ? "+" : ""}${deviceDelta} device${Math.abs(deviceDelta) === 1 ? "" : "s"}`,
      });
    } else if (totalDeviceAdds > 0) {
      chips.push({
        kind: "change",
        label: `${totalDeviceAdds} device${totalDeviceAdds === 1 ? "" : "s"} replaced`,
      });
    }
    let clipDelta = 0;
    for (const t of sd.modifiedTracks) {
      clipDelta += t.clipCountDelta;
    }
    if (clipDelta !== 0) {
      chips.push({
        kind: clipDelta > 0 ? "add" : "remove",
        label: `${clipDelta > 0 ? "+" : ""}${clipDelta} clip${Math.abs(clipDelta) === 1 ? "" : "s"}`,
      });
    }
    if (sd.modifiedTracks.some((t) => t.mixerChanges.length > 0)) {
      chips.push({ kind: "neutral", label: "mixer changes" });
    }
    // Track color changes
    const colorChanges = sd.modifiedTracks.filter((t) => t.colorChanged).length;
    if (colorChanges > 0) {
      chips.push({
        kind: "change",
        label: `${colorChanges} track${colorChanges === 1 ? "" : "s"} recolored`,
      });
    }
    // Device enable/disable toggles
    let toggleCount = 0;
    for (const t of sd.modifiedTracks) {
      toggleCount += t.deviceToggles.length;
    }
    if (toggleCount > 0) {
      chips.push({
        kind: "change",
        label: `${toggleCount} device${toggleCount === 1 ? "" : "s"} toggled`,
      });
    }
    // Arrangement length
    if (sd.arrangementLengthChange) {
      const delta =
        sd.arrangementLengthChange.to - sd.arrangementLengthChange.from;
      const bars = Math.round(Math.abs(delta) / 4);
      chips.push({
        kind: delta > 0 ? "add" : "remove",
        label: `${delta > 0 ? "+" : "\u2212"}${bars} bar${bars === 1 ? "" : "s"}`,
      });
    }
    // Scene count
    if (sd.sceneCountChange) {
      const delta = sd.sceneCountChange.to - sd.sceneCountChange.from;
      chips.push({
        kind: delta > 0 ? "add" : "remove",
        label: `${delta > 0 ? "+" : "\u2212"}${Math.abs(delta)} scene${Math.abs(delta) === 1 ? "" : "s"}`,
      });
    }
    // Locator / cue point count
    if (sd.locatorCountChange) {
      const delta = sd.locatorCountChange.to - sd.locatorCountChange.from;
      chips.push({
        kind: delta > 0 ? "add" : "remove",
        label: `${delta > 0 ? "+" : "\u2212"}${Math.abs(delta)} locator${Math.abs(delta) === 1 ? "" : "s"}`,
      });
    }
    // Track reorder
    if (sd.tracksReordered) {
      chips.push({ kind: "change", label: "tracks reordered" });
    }
  }
  if (save.changes) {
    const added = save.changes.addedFiles.filter((f) => !isAls(f));
    const removed = save.changes.removedFiles.filter((f) => !isAls(f));
    if (added.length > 0) {
      chips.push({
        kind: "add",
        label: `+${added.length} file${added.length === 1 ? "" : "s"}`,
      });
    }
    if (removed.length > 0) {
      chips.push({
        kind: "remove",
        label: `\u2212${removed.length} file${removed.length === 1 ? "" : "s"}`,
      });
    }
  }
  return chips;
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
 * A save is "minor" when analysis found no structural change. Runs of minor
 * saves collapse into one row. Anything the user cares about (named, noted,
 * pinned, previewed, latest, first) is never minor, so it is never hidden.
 */
function isMinorSave(save: Save, keep: (save: Save) => boolean): boolean {
  if (!save.auto || keep(save)) {
    return false;
  }
  const sd = save.setDiff;
  if (sd) {
    if (sd.tempoChange || sd.timeSignatureChange) {
      return false;
    }
    if (
      sd.arrangementLengthChange ||
      sd.sceneCountChange ||
      sd.locatorCountChange
    ) {
      return false;
    }
    if (sd.tracksReordered) {
      return false;
    }
    if (
      sd.addedTracks.length ||
      sd.removedTracks.length ||
      sd.modifiedTracks.length
    ) {
      return false;
    }
  }
  if (save.changes) {
    if (save.changes.addedFiles.filter((f) => !isAls(f)).length) {
      return false;
    }
    if (save.changes.removedFiles.filter((f) => !isAls(f)).length) {
      return false;
    }
  }
  return true;
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
    if (isMinorSave(save, keep)) {
      const group: Save[] = [save];
      let j = i + 1;
      while (j < saves.length && isMinorSave(saves[j]!, keep)) {
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
