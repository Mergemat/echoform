/**
 * set-compare.ts – Explain what changed between two versions of a Live Set
 * in the terms a producer uses: which part of the song, which track, which
 * notes, which device, how many dB.
 */

import type { Clip, LiveSet, Note, Track } from "./live-set";
import {
  ANALYSIS_VERSION,
  type ChangeWeight,
  type ClipAnalysis,
  type MiniNote,
  type SaveAnalysis,
  type SaveSummary,
  type SetChange,
  type TrackAnalysis,
  type TrackChange,
} from "./types";

const SHAPE_BUCKETS = 64;
const MAX_NOTES_PER_CLIP = 512;
const MAX_TOUCHED = 8;
const DB_EPSILON = 0.25;
const PARAM_EPSILON = 1e-6;
/** Clip edges move by fractions of a beat when Live re-derives warped clips. */
const POSITION_EPSILON = 0.01;

// ── Bars ────────────────────────────────────────────────────────────

export function beatsPerBar(timeSignature: string): number {
  const [numerator, denominator] = timeSignature.split("/").map(Number);
  if (!(numerator && denominator)) {
    return 4;
  }
  return (numerator * 4) / denominator;
}

export function formatBars(start: number, end: number, perBar: number): string {
  const first = Math.floor(start / perBar) + 1;
  const last = Math.max(first, Math.ceil(end / perBar));
  return first === last ? `bar ${first}` : `bars ${first}–${last}`;
}

function formatDb(db: number): string {
  if (!Number.isFinite(db)) {
    return "−∞ dB";
  }
  return `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(1)} dB`;
}

// ── Names ───────────────────────────────────────────────────────────

/** Live numbers default track names ("3-Audio") and renumbers them on insert. */
const withoutTrackNumber = (name: string) => name.replace(/^\d+-/, "");

/**
 * How a producer refers to a track: without Live's auto-number ("4-Serum 2"
 * → "Serum 2") and without the "[2026-01-10 084550]" suffix Live adds to
 * consolidated audio.
 */
export function displayName(name: string): string {
  return (
    withoutTrackNumber(name)
      .replace(/\s*\[\d{4}-\d{2}-\d{2} \d{6}\]$/, "")
      .trim() || name
  );
}

// ── Clips ───────────────────────────────────────────────────────────

const noteKey = (note: Note) => `${note.key}@${note.time.toFixed(4)}`;

function mini(note: Note): MiniNote {
  return { d: note.duration, k: note.key, t: note.time };
}

function diffNotes(before: Note[], after: Note[]): ClipAnalysis["notes"] {
  const previous = new Map(before.map((note) => [noteKey(note), note]));
  const added: MiniNote[] = [];
  const kept: MiniNote[] = [];
  for (const note of after) {
    const old = previous.get(noteKey(note));
    if (old && Math.abs(old.duration - note.duration) < PARAM_EPSILON) {
      kept.push(mini(note));
      previous.delete(noteKey(note));
    } else {
      added.push(mini(note));
    }
  }
  const removed = [...previous.values()].map(mini);
  return {
    added: added.slice(0, MAX_NOTES_PER_CLIP),
    kept: kept.slice(0, MAX_NOTES_PER_CLIP),
    removed: removed.slice(0, MAX_NOTES_PER_CLIP),
  };
}

function clipView(
  clip: Clip,
  status: ClipAnalysis["status"],
  extra: Partial<ClipAnalysis> = {},
): ClipAnalysis {
  return {
    color: clip.color,
    end: clip.end,
    kind: clip.kind,
    movedFrom: null,
    name: clip.name,
    notes: null,
    sample: clip.sample,
    start: clip.start,
    status,
    ...extra,
  };
}

const overlaps = (a: Clip, b: Clip) => a.start < b.end && b.start < a.end;

/**
 * Pair clips across versions: identical → same, same content elsewhere → moved,
 * overlapping in place → edited, the rest → added / removed.
 */
function compareClips(
  before: Clip[],
  after: Clip[],
  tempoChanged: boolean,
): ClipAnalysis[] {
  const remaining = new Set(before);
  const result: ClipAnalysis[] = [];
  const unmatched: Clip[] = [];

  for (const clip of after) {
    // Unwarped audio keeps its length in seconds, so its length in beats
    // follows the tempo; that is not an edit.
    const same = [...remaining].find(
      (old) =>
        old.contentHash === clip.contentHash &&
        Math.abs(old.start - clip.start) < POSITION_EPSILON &&
        (Math.abs(old.end - clip.end) < POSITION_EPSILON ||
          (tempoChanged && clip.kind === "audio")),
    );
    if (same) {
      remaining.delete(same);
      result.push(clipView(clip, "same"));
    } else {
      unmatched.push(clip);
    }
  }

  const stillUnmatched: Clip[] = [];
  for (const clip of unmatched) {
    const moved = [...remaining]
      .filter(
        (old) =>
          old.contentHash === clip.contentHash &&
          Math.abs(old.start - clip.start) >= POSITION_EPSILON,
      )
      .sort(
        (a, b) => Math.abs(a.start - clip.start) - Math.abs(b.start - clip.start),
      )[0];
    if (moved) {
      remaining.delete(moved);
      result.push(clipView(clip, "moved", { movedFrom: moved.start }));
    } else {
      stillUnmatched.push(clip);
    }
  }

  for (const clip of stillUnmatched) {
    const edited = [...remaining].find(
      (old) => old.kind === clip.kind && overlaps(old, clip),
    );
    if (edited) {
      remaining.delete(edited);
      result.push(
        clipView(clip, "edited", {
          notes: clip.kind === "midi" ? diffNotes(edited.notes, clip.notes) : null,
        }),
      );
    } else {
      result.push(
        clipView(clip, "added", {
          notes: clip.kind === "midi" ? diffNotes([], clip.notes) : null,
        }),
      );
    }
  }

  for (const old of remaining) {
    result.push(clipView(old, "removed"));
  }
  return result.sort((a, b) => a.start - b.start);
}

// ── Devices, mixer, automation ──────────────────────────────────────

function compareDevices(before: Track, after: Track): TrackChange[] {
  const changes: TrackChange[] = [];
  const previous = new Map(before.devices.map((d) => [d.id, d]));
  for (const device of after.devices) {
    const old = previous.get(device.id);
    if (!old || old.className !== device.className) {
      changes.push({ device: device.name, type: "device-added" });
      continue;
    }
    previous.delete(device.id);
    if (old.enabled !== device.enabled) {
      changes.push({
        device: device.name,
        type: device.enabled ? "device-on" : "device-off",
      });
    }
    if (old.stateHash === device.stateHash) {
      if (old.pluginStateHash !== device.pluginStateHash) {
        changes.push({ device: device.name, type: "device-state" });
      }
      continue;
    }
    const params = Object.entries(device.params)
      .filter(
        ([name, to]) =>
          name in old.params && Math.abs((old.params[name] ?? 0) - to) > PARAM_EPSILON,
      )
      .map(([name, to]) => ({ from: old.params[name] ?? 0, name, to }));
    const onlyToggled = old.enabled !== device.enabled && params.length === 0;
    if (!onlyToggled) {
      changes.push({ device: device.name, params, type: "device-settings" });
    }
  }
  for (const old of previous.values()) {
    changes.push({ device: old.name, type: "device-removed" });
  }
  return changes;
}

function compareMixer(before: Track, after: Track): TrackChange[] {
  const changes: TrackChange[] = [];
  const a = before.mixer;
  const b = after.mixer;
  const dbMoved = (from: number, to: number) =>
    Number.isFinite(from) !== Number.isFinite(to) ||
    (Number.isFinite(to) && Math.abs(to - from) >= DB_EPSILON);
  if (dbMoved(a.volumeDb, b.volumeDb)) {
    changes.push({ from: a.volumeDb, to: b.volumeDb, type: "volume" });
  }
  if (Math.abs(a.pan - b.pan) > 0.01) {
    changes.push({ from: a.pan, to: b.pan, type: "pan" });
  }
  b.sends.forEach((to, index) => {
    const from = a.sends[index];
    if (from !== undefined && dbMoved(from, to)) {
      changes.push({ from, index, to, type: "send" });
    }
  });
  if (a.muted !== b.muted) {
    changes.push({ type: b.muted ? "muted" : "unmuted" });
  }
  if (a.soloed !== b.soloed) {
    changes.push({ type: b.soloed ? "soloed" : "unsoloed" });
  }
  return changes;
}

function compareAutomation(before: Track, after: Track): TrackChange[] {
  const changes: TrackChange[] = [];
  const previous = new Map(before.automation.map((lane) => [lane.target, lane]));
  for (const lane of after.automation) {
    const old = previous.get(lane.target);
    previous.delete(lane.target);
    if (!old) {
      changes.push({ status: "added", target: lane.target, type: "automation" });
    } else if (old.hash !== lane.hash) {
      changes.push({ status: "edited", target: lane.target, type: "automation" });
    }
  }
  for (const old of previous.values()) {
    changes.push({ status: "removed", target: old.target, type: "automation" });
  }
  return changes;
}

// ── Tracks ──────────────────────────────────────────────────────────

function depthOf(track: Track, byId: Map<string, Track>): number {
  let depth = 0;
  let parent = track.groupId ? byId.get(track.groupId) : undefined;
  while (parent && depth < 8) {
    depth += 1;
    parent = parent.groupId ? byId.get(parent.groupId) : undefined;
  }
  return depth;
}

function trackView(
  track: Track,
  depth: number,
  status: TrackAnalysis["status"],
  clips: ClipAnalysis[],
  changes: TrackChange[] = [],
): TrackAnalysis {
  return {
    changes,
    clips,
    color: track.color,
    depth,
    id: track.id,
    name: track.name,
    status,
    type: track.type,
  };
}

function compareTracks(before: LiveSet | null, after: LiveSet): TrackAnalysis[] {
  const tempoChanged = before !== null && before.tempo !== after.tempo;
  const afterById = new Map(after.tracks.map((t) => [t.id, t]));
  const beforeById = new Map(before?.tracks.map((t) => [t.id, t]) ?? []);
  const result: TrackAnalysis[] = [];

  for (const track of after.tracks) {
    const depth = depthOf(track, afterById);
    const old = beforeById.get(track.id);
    if (!before) {
      result.push(trackView(track, depth, "same", track.clips.map((c) => clipView(c, "same"))));
      continue;
    }
    if (!old || old.type !== track.type) {
      result.push(
        trackView(
          track,
          depth,
          "added",
          track.clips.map((clip) =>
            clipView(clip, "added", {
              notes: clip.kind === "midi" ? diffNotes([], clip.notes) : null,
            }),
          ),
        ),
      );
      continue;
    }
    beforeById.delete(track.id);
    const changes: TrackChange[] = [
      ...(withoutTrackNumber(old.name) === withoutTrackNumber(track.name)
        ? []
        : [{ from: old.name, type: "renamed" as const }]),
      ...compareDevices(old, track),
      ...compareMixer(old, track),
      ...compareAutomation(old, track),
      ...(old.sessionClipCount === track.sessionClipCount
        ? []
        : [
            {
              from: old.sessionClipCount,
              to: track.sessionClipCount,
              type: "session-clips" as const,
            },
          ]),
    ];
    const clips = compareClips(old.clips, track.clips, tempoChanged);
    const clipsChanged = clips.some((clip) => clip.status !== "same");
    const meaningful = changes.some((c) => c.type !== "device-state");
    result.push(
      trackView(
        track,
        depth,
        meaningful || clipsChanged ? "changed" : "same",
        clips,
        changes,
      ),
    );
  }

  // Removed tracks stay visible (ghosted) at the end.
  for (const old of beforeById.values()) {
    result.push(
      trackView(
        old,
        0,
        "removed",
        old.clips.map((clip) => clipView(clip, "removed")),
      ),
    );
  }
  return result;
}

function compareSet(before: LiveSet | null, after: LiveSet): SetChange[] {
  if (!before) {
    return [];
  }
  const changes: SetChange[] = [];
  if (Math.abs(before.tempo - after.tempo) > 0.001) {
    changes.push({ from: before.tempo, to: after.tempo, type: "tempo" });
  }
  if (before.timeSignature !== after.timeSignature) {
    changes.push({
      from: before.timeSignature,
      to: after.timeSignature,
      type: "time-signature",
    });
  }
  const key = (l: { name: string; time: number }) => `${l.time}:${l.name}`;
  const beforeKeys = new Set(before.locators.map(key));
  const afterKeys = new Set(after.locators.map(key));
  for (const locator of after.locators) {
    if (!beforeKeys.has(key(locator))) {
      changes.push({ ...locator, type: "locator-added" });
    }
  }
  for (const locator of before.locators) {
    if (!afterKeys.has(key(locator))) {
      changes.push({ ...locator, type: "locator-removed" });
    }
  }
  return changes;
}

// ── Summary ─────────────────────────────────────────────────────────

function lengthOf(set: LiveSet): number {
  let end = 0;
  for (const track of set.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.end);
    }
  }
  for (const locator of set.locators) {
    end = Math.max(end, locator.time);
  }
  return end;
}

/** How busy each slice of the arrangement is: fraction of clip-holding tracks playing. */
function silhouette(set: LiveSet, length: number): number[] {
  const shape = new Array<number>(SHAPE_BUCKETS).fill(0);
  const playable = set.tracks.filter((t) => t.clips.length > 0);
  if (length <= 0 || playable.length === 0) {
    return shape;
  }
  const size = length / SHAPE_BUCKETS;
  for (const track of playable) {
    const covered = new Array<boolean>(SHAPE_BUCKETS).fill(false);
    for (const clip of track.clips) {
      if (clip.disabled) {
        continue;
      }
      const first = Math.max(0, Math.floor(clip.start / size));
      const last = Math.min(SHAPE_BUCKETS - 1, Math.ceil(clip.end / size) - 1);
      for (let i = first; i <= last; i++) {
        covered[i] = true;
      }
    }
    covered.forEach((on, i) => {
      if (on) {
        shape[i]! += 1;
      }
    });
  }
  return shape.map((count) => Math.round((count / playable.length) * 100) / 100);
}

function changedRegions(tracks: TrackAnalysis[]): SaveSummary["regions"] {
  const regions: SaveSummary["regions"] = [];
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.status === "same") {
        continue;
      }
      regions.push({ color: track.color, end: clip.end, start: clip.start });
      if (clip.movedFrom !== null) {
        const length = clip.end - clip.start;
        regions.push({
          color: track.color,
          end: clip.movedFrom + length,
          start: clip.movedFrom,
        });
      }
    }
  }
  regions.sort((a, b) => a.start - b.start);
  // Merge touching regions of the same colour to keep the stored list small.
  const merged: SaveSummary["regions"] = [];
  for (const region of regions) {
    const last = merged.findLast((r) => r.color === region.color);
    if (last && region.start <= last.end) {
      last.end = Math.max(last.end, region.end);
    } else {
      merged.push({ ...region });
    }
  }
  return merged.slice(0, 48);
}

function rangeOf(clips: ClipAnalysis[]): { end: number; start: number } {
  return {
    end: Math.max(...clips.map((c) => c.end)),
    start: Math.min(...clips.map((c) => c.start)),
  };
}

/** Ranked phrases; the first few become the headline. */
function phrases(
  tracks: TrackAnalysis[],
  setChanges: SetChange[],
  perBar: number,
): string[] {
  const out: { rank: number; text: string }[] = [];
  const push = (rank: number, text: string) => out.push({ rank, text });

  for (const change of setChanges) {
    if (change.type === "tempo") {
      push(0, `Tempo ${change.from} → ${change.to} BPM`);
    } else if (change.type === "time-signature") {
      push(0, `Time signature ${change.from} → ${change.to}`);
    } else if (change.type === "locator-added") {
      push(6, `Marker “${change.name || "untitled"}” added`);
    }
  }

  for (const track of tracks) {
    const name = displayName(track.name);
    if (track.status === "added") {
      push(1, `New track ${name}`);
      continue;
    }
    if (track.status === "removed") {
      push(1, `Removed ${name}`);
      continue;
    }
    const added = track.clips.filter((c) => c.status === "added");
    const removed = track.clips.filter((c) => c.status === "removed");
    const edited = track.clips.filter((c) => c.status === "edited");
    const moved = track.clips.filter((c) => c.status === "moved");
    if (added.length > 0) {
      const r = rangeOf(added);
      push(2, `${name}: new ${added[0]!.kind === "midi" ? "part" : "audio"} in ${formatBars(r.start, r.end, perBar)}`);
    }
    if (edited.length > 0) {
      const r = rangeOf(edited);
      const noteEdits = edited.some(
        (c) => c.notes && (c.notes.added.length > 0 || c.notes.removed.length > 0),
      );
      push(2, `${name}: ${noteEdits ? "notes" : "clips"} edited in ${formatBars(r.start, r.end, perBar)}`);
    }
    if (removed.length > 0) {
      const r = rangeOf(removed);
      push(3, `${name}: cleared ${formatBars(r.start, r.end, perBar)}`);
    }
    if (moved.length > 0) {
      push(3, `${name}: clips moved`);
    }
    for (const change of track.changes) {
      switch (change.type) {
        case "device-state":
          // Opaque plugin data; may change without the user touching anything.
          break;
        case "renamed":
          push(5, `${displayName(change.from)} renamed to ${name}`);
          break;
        case "device-added":
          push(3, `${change.device} added on ${name}`);
          break;
        case "device-removed":
          push(3, `${change.device} removed from ${name}`);
          break;
        case "device-on":
        case "device-off":
          push(4, `${change.device} on ${name} turned ${change.type === "device-on" ? "on" : "off"}`);
          break;
        case "device-settings":
          push(
            5,
            change.params.length > 0
              ? `${change.device} on ${name}: ${change.params.map((p) => p.name).slice(0, 2).join(", ")}`
              : `${change.device} on ${name} tweaked`,
          );
          break;
        case "volume":
          push(
            4,
            `${name} ${change.to > change.from ? "louder" : "quieter"} (${formatDb(change.to - change.from)})`,
          );
          break;
        case "muted":
        case "unmuted":
          push(4, `${name} ${change.type}`);
          break;
        case "automation":
          push(4, `${name}: ${change.target} automation ${change.status}`);
          break;
        default:
          push(6, `${name} mix tweaked`);
      }
    }
  }
  return out
    .sort((a, b) => a.rank - b.rank)
    .map((p) => p.text)
    .filter((text, index, all) => all.indexOf(text) === index);
}

function weigh(tracks: TrackAnalysis[], setChanges: SetChange[]): ChangeWeight {
  const structural =
    setChanges.some((c) => c.type === "tempo" || c.type === "time-signature") ||
    tracks.some(
      (t) =>
        t.status === "added" ||
        t.status === "removed" ||
        t.clips.some((c) => c.status !== "same"),
    );
  if (structural) {
    return "major";
  }
  return setChanges.length > 0 ||
    tracks.some((t) => t.changes.some((c) => c.type !== "device-state"))
    ? "minor"
    : "none";
}

// ── Entry point ─────────────────────────────────────────────────────

export function analyzeSets(
  before: LiveSet | null,
  after: LiveSet,
  baseSaveId: string | null,
): SaveAnalysis {
  const perBar = beatsPerBar(after.timeSignature);
  const tracks = compareTracks(before, after);
  const setChanges = compareSet(before, after);
  const length = Math.max(lengthOf(after), before ? lengthOf(before) : 0);
  const weight = before ? weigh(tracks, setChanges) : "major";
  const lines = phrases(tracks, setChanges, perBar);
  const bars = Math.ceil(lengthOf(after) / perBar);
  const playable = after.tracks.filter((t) => t.type !== "group" && t.type !== "return");

  const headline = !before
    ? `First save · ${playable.length} tracks, ${bars} bars at ${after.tempo} BPM`
    : weight === "none" || lines.length === 0
      ? "No musical changes"
      : lines[0]!;

  const summary: SaveSummary = {
    baseSaveId,
    beatsPerBar: perBar,
    changes: before && weight !== "none" ? lines : [],
    first: !before,
    headline,
    lengthBeats: length,
    regions: before ? changedRegions(tracks) : [],
    shape: silhouette(after, length),
    touched: tracks
      .filter((t) => t.status !== "same")
      .slice(0, MAX_TOUCHED)
      .map((t) => ({ color: t.color, name: displayName(t.name) })),
    trackCount: playable.length,
    version: ANALYSIS_VERSION,
    weight,
  };

  return {
    baseSaveId,
    beatsPerBar: perBar,
    lengthBeats: length,
    locators: after.locators,
    setChanges,
    summary,
    tempo: after.tempo,
    timeSignature: after.timeSignature,
    tracks,
  };
}
