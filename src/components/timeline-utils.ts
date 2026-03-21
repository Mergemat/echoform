import { extname } from '@/lib/path';
import type { Save } from '@/lib/types';

// ── Formatters ───────────────────────────────────────────────────────
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatSizeDelta(bytes: number): string {
  const abs = Math.abs(bytes);
  const sign = bytes >= 0 ? '+' : '\u2212';
  if (abs < 1024) return `${sign}${abs}B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(0)}K`;
  return `${sign}${(abs / 1024 / 1024).toFixed(1)}M`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── File-type helpers ────────────────────────────────────────────────
const AUDIO_EXT = new Set([
  '.aif',
  '.aiff',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.wav',
]);

export function isAudio(p: string) {
  return AUDIO_EXT.has(extname(p).toLowerCase());
}

export function isAls(p: string) {
  return extname(p).toLowerCase() === '.als';
}

// ── Chip builders ────────────────────────────────────────────────────
export type Chip = {
  label: string;
  kind: 'neutral' | 'add' | 'remove' | 'change';
};

export function buildChips(save: Save): Chip[] {
  const chips: Chip[] = [];
  const sd = save.setDiff;
  if (sd) {
    if (sd.tempoChange)
      chips.push({
        label: `${sd.tempoChange.from}\u2192${sd.tempoChange.to} bpm`,
        kind: 'change',
      });
    if (sd.timeSignatureChange)
      chips.push({
        label: `${sd.timeSignatureChange.from}\u2192${sd.timeSignatureChange.to}`,
        kind: 'change',
      });
    const addByType: Record<string, number> = {};
    const remByType: Record<string, number> = {};
    for (const t of sd.addedTracks)
      addByType[t.type] = (addByType[t.type] ?? 0) + 1;
    for (const t of sd.removedTracks)
      remByType[t.type] = (remByType[t.type] ?? 0) + 1;
    const TL: Record<string, string> = {
      midi: 'MIDI',
      audio: 'Audio',
      return: 'Return',
      group: 'Group',
    };
    for (const [type, count] of Object.entries(addByType))
      chips.push({ label: `+${count} ${TL[type] ?? type}`, kind: 'add' });
    for (const [type, count] of Object.entries(remByType))
      chips.push({
        label: `\u2212${count} ${TL[type] ?? type}`,
        kind: 'remove',
      });
    const renames = sd.modifiedTracks.filter((t) => t.renamedFrom);
    if (renames.length === 1)
      chips.push({
        label: `\u201c${renames[0]!.renamedFrom}\u201d\u2192\u201c${renames[0]!.name}\u201d`,
        kind: 'change',
      });
    else if (renames.length >= 2)
      chips.push({ label: `${renames.length} tracks renamed`, kind: 'change' });
    let deviceDelta = 0;
    for (const t of sd.modifiedTracks)
      deviceDelta += t.addedDevices.length - t.removedDevices.length;
    if (deviceDelta !== 0)
      chips.push({
        label: `${deviceDelta > 0 ? '+' : ''}${deviceDelta} device${Math.abs(deviceDelta) !== 1 ? 's' : ''}`,
        kind: deviceDelta > 0 ? 'add' : 'remove',
      });
    let clipDelta = 0;
    for (const t of sd.modifiedTracks) clipDelta += t.clipCountDelta;
    if (clipDelta !== 0)
      chips.push({
        label: `${clipDelta > 0 ? '+' : ''}${clipDelta} clip${Math.abs(clipDelta) !== 1 ? 's' : ''}`,
        kind: clipDelta > 0 ? 'add' : 'remove',
      });
    if (sd.modifiedTracks.some((t) => t.mixerChanges.length > 0))
      chips.push({ label: 'mixer changes', kind: 'neutral' });
  }
  if (save.changes) {
    const added = save.changes.addedFiles.filter((f) => !isAls(f));
    const removed = save.changes.removedFiles.filter((f) => !isAls(f));
    if (added.length > 0)
      chips.push({
        label: `+${added.length} file${added.length !== 1 ? 's' : ''}`,
        kind: 'add',
      });
    if (removed.length > 0)
      chips.push({
        label: `\u2212${removed.length} file${removed.length !== 1 ? 's' : ''}`,
        kind: 'remove',
      });
  }
  return chips;
}

// ── Auto-save grouping ───────────────────────────────────────────────
export type DisplayItem =
  | { type: 'save'; save: Save }
  | { type: 'group'; saves: Save[]; key: string };

export function isTrivialAutoSave(save: Save): boolean {
  if (!save.auto) return false;
  const sd = save.setDiff;
  if (sd) {
    if (sd.tempoChange || sd.timeSignatureChange) return false;
    if (
      sd.addedTracks.length ||
      sd.removedTracks.length ||
      sd.modifiedTracks.length
    )
      return false;
  }
  if (save.changes) {
    if (save.changes.addedFiles.filter((f) => !isAls(f)).length) return false;
    if (save.changes.removedFiles.filter((f) => !isAls(f)).length) return false;
  }
  return true;
}

export function buildDisplayItems(
  saves: Save[],
  expandedGroups: Set<string>,
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
        const key = group[0]!.id;
        if (expandedGroups.has(key)) {
          for (const s of group) items.push({ type: 'save', save: s });
        } else items.push({ type: 'group', saves: group, key });
        i = j;
        continue;
      }
    }
    items.push({ type: 'save', save });
    i++;
  }
  return items;
}
