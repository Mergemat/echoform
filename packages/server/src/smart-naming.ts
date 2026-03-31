/**
 * smart-naming.ts – Generate human-readable save labels from diffs.
 *
 * Consumes SetDiff + ChangeSummary and produces a short descriptive label
 * like "Added Bass track, tempo 120→128" or "3 files changed".
 * Fallback: "Auto-save {timestamp}" when no meaningful diff.
 */

import type { ChangeSummary, SetDiff } from "./types";

/** Build a concise label from a semantic diff and file changes. */
export function formatDiffAsLabel(
  setDiff?: SetDiff,
  changes?: ChangeSummary
): string {
  const parts: string[] = [];

  if (setDiff) {
    // Tempo change
    if (setDiff.tempoChange) {
      parts.push(`tempo ${setDiff.tempoChange.from}→${setDiff.tempoChange.to}`);
    }
    // Time signature
    if (setDiff.timeSignatureChange) {
      parts.push(
        `time sig ${setDiff.timeSignatureChange.from}→${setDiff.timeSignatureChange.to}`
      );
    }
    // Added tracks
    for (const t of setDiff.addedTracks.slice(0, 2)) {
      parts.push(`added ${t.name}`);
    }
    if (setDiff.addedTracks.length > 2) {
      parts.push(`+${setDiff.addedTracks.length - 2} more tracks`);
    }
    // Removed tracks
    for (const t of setDiff.removedTracks.slice(0, 2)) {
      parts.push(`removed ${t.name}`);
    }
    if (setDiff.removedTracks.length > 2) {
      parts.push(`+${setDiff.removedTracks.length - 2} more removed`);
    }
    // Modified tracks (summarize)
    if (setDiff.modifiedTracks.length > 0) {
      const names = setDiff.modifiedTracks.slice(0, 2).map((t) => t.name);
      const suffix =
        setDiff.modifiedTracks.length > 2
          ? ` +${setDiff.modifiedTracks.length - 2} more`
          : "";
      parts.push(`edited ${names.join(", ")}${suffix}`);
    }
  }

  // File-level changes as fallback when no semantic diff
  if (parts.length === 0 && changes) {
    const total =
      changes.addedFiles.length +
      changes.removedFiles.length +
      changes.modifiedFiles.length;
    if (total > 0) {
      parts.push(`${total} file${total === 1 ? "" : "s"} changed`);
    }
  }

  if (parts.length === 0) {
    return autoTimestamp();
  }
  // Capitalize first part, join with ", "
  const label = parts.join(", ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function autoTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Auto-save ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
