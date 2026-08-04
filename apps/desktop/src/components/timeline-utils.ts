import { basename, extname } from "@/lib/path";
import type { Idea, Project, Save } from "@/lib/types";

/** Display name for an Ableton set file (filename without extension). */
export function fileTabName(idea: Idea): string {
  const name = basename(idea.setPath);
  const ext = extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

// ── Formatters ───────────────────────────────────────────────────────
function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}:${m}${ampm}`;
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

// ── Auto-save grouping ───────────────────────────────────────────────
type DisplayItem =
  | { type: "save"; save: Save }
  | { type: "group"; saves: Save[]; key: string };

function isTrivialAutoSave(save: Save): boolean {
  if (!save.auto) {
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
  expandedGroups: Set<string>
): DisplayItem[] {
  const items: DisplayItem[] = [];
  let i = 0;
  while (i < saves.length) {
    const save = saves[i]!;
    if (isTrivialAutoSave(save)) {
      const group: Save[] = [save];
      let j = i + 1;
      while (j < saves.length && isTrivialAutoSave(saves[j]!)) {
        group.push(saves[j]!);
        j++;
      }
      if (group.length >= 2) {
        const key = group[0]?.id;
        if (expandedGroups.has(key)) {
          for (const s of group) {
            items.push({ save: s, type: "save" });
          }
        } else {
          items.push({ key, saves: group, type: "group" });
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

type TimelineDisplayItem =
  | {
      type: "save";
      save: Save;
      idea: Idea;
    }
  | {
      type: "group";
      saves: Save[];
      key: string;
      idea: Idea;
    };

export function buildTimelineDisplayItems(
  project: Project,
  focusedIdeaId: string | null,
  expandedGroups: Set<string>
): TimelineDisplayItem[] {
  const idea =
    project.ideas.find(
      (candidate) => candidate.id === (focusedIdeaId ?? project.currentIdeaId)
    ) ?? project.ideas[0];
  if (!idea) {
    return [];
  }

  const saves = project.saves
    .filter((save) => save.ideaId === idea.id)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return buildDisplayItems(saves, expandedGroups).map((item) => ({
    ...item,
    idea,
  }));
}
