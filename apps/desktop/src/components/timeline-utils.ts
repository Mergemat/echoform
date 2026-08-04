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
    month: "short",
    day: "numeric",
  })} ${time}`;
}

function formatSaveTitle(iso: string, options?: { compact?: boolean }): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: options?.compact ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
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
        label: `${sd.tempoChange.from}\u2192${sd.tempoChange.to} bpm`,
        kind: "change",
      });
    }
    if (sd.timeSignatureChange) {
      chips.push({
        label: `${sd.timeSignatureChange.from}\u2192${sd.timeSignatureChange.to}`,
        kind: "change",
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
      midi: "MIDI",
      audio: "Audio",
      return: "Return",
      group: "Group",
    };
    for (const [type, count] of Object.entries(addByType)) {
      chips.push({ label: `+${count} ${TL[type] ?? type}`, kind: "add" });
    }
    for (const [type, count] of Object.entries(remByType)) {
      chips.push({
        label: `\u2212${count} ${TL[type] ?? type}`,
        kind: "remove",
      });
    }
    const renames = sd.modifiedTracks.filter((t) => t.renamedFrom);
    if (renames.length === 1) {
      chips.push({
        label: `\u201c${renames[0]?.renamedFrom}\u201d\u2192\u201c${renames[0]?.name}\u201d`,
        kind: "change",
      });
    } else if (renames.length >= 2) {
      chips.push({ label: `${renames.length} tracks renamed`, kind: "change" });
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
        label: `${deviceDelta > 0 ? "+" : ""}${deviceDelta} device${Math.abs(deviceDelta) === 1 ? "" : "s"}`,
        kind: deviceDelta > 0 ? "add" : "remove",
      });
    } else if (totalDeviceAdds > 0) {
      chips.push({
        label: `${totalDeviceAdds} device${totalDeviceAdds === 1 ? "" : "s"} replaced`,
        kind: "change",
      });
    }
    let clipDelta = 0;
    for (const t of sd.modifiedTracks) {
      clipDelta += t.clipCountDelta;
    }
    if (clipDelta !== 0) {
      chips.push({
        label: `${clipDelta > 0 ? "+" : ""}${clipDelta} clip${Math.abs(clipDelta) === 1 ? "" : "s"}`,
        kind: clipDelta > 0 ? "add" : "remove",
      });
    }
    if (sd.modifiedTracks.some((t) => t.mixerChanges.length > 0)) {
      chips.push({ label: "mixer changes", kind: "neutral" });
    }
    // Track color changes
    const colorChanges = sd.modifiedTracks.filter((t) => t.colorChanged).length;
    if (colorChanges > 0) {
      chips.push({
        label: `${colorChanges} track${colorChanges === 1 ? "" : "s"} recolored`,
        kind: "change",
      });
    }
    // Device enable/disable toggles
    let toggleCount = 0;
    for (const t of sd.modifiedTracks) {
      toggleCount += t.deviceToggles.length;
    }
    if (toggleCount > 0) {
      chips.push({
        label: `${toggleCount} device${toggleCount === 1 ? "" : "s"} toggled`,
        kind: "change",
      });
    }
    // Arrangement length
    if (sd.arrangementLengthChange) {
      const delta =
        sd.arrangementLengthChange.to - sd.arrangementLengthChange.from;
      const bars = Math.round(Math.abs(delta) / 4);
      chips.push({
        label: `${delta > 0 ? "+" : "\u2212"}${bars} bar${bars === 1 ? "" : "s"}`,
        kind: delta > 0 ? "add" : "remove",
      });
    }
    // Scene count
    if (sd.sceneCountChange) {
      const delta = sd.sceneCountChange.to - sd.sceneCountChange.from;
      chips.push({
        label: `${delta > 0 ? "+" : "\u2212"}${Math.abs(delta)} scene${Math.abs(delta) === 1 ? "" : "s"}`,
        kind: delta > 0 ? "add" : "remove",
      });
    }
    // Locator / cue point count
    if (sd.locatorCountChange) {
      const delta = sd.locatorCountChange.to - sd.locatorCountChange.from;
      chips.push({
        label: `${delta > 0 ? "+" : "\u2212"}${Math.abs(delta)} locator${Math.abs(delta) === 1 ? "" : "s"}`,
        kind: delta > 0 ? "add" : "remove",
      });
    }
    // Track reorder
    if (sd.tracksReordered) {
      chips.push({ label: "tracks reordered", kind: "change" });
    }
  }
  if (save.changes) {
    const added = save.changes.addedFiles.filter((f) => !isAls(f));
    const removed = save.changes.removedFiles.filter((f) => !isAls(f));
    if (added.length > 0) {
      chips.push({
        label: `+${added.length} file${added.length === 1 ? "" : "s"}`,
        kind: "add",
      });
    }
    if (removed.length > 0) {
      chips.push({
        label: `\u2212${removed.length} file${removed.length === 1 ? "" : "s"}`,
        kind: "remove",
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
            items.push({ type: "save", save: s });
          }
        } else {
          items.push({ type: "group", saves: group, key });
        }
        i = j;
        continue;
      }
    }
    items.push({ type: "save", save });
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
