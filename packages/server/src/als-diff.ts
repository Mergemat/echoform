/**
 * als-diff.ts – Compute a semantic diff between two Ableton Live Set snapshots.
 *
 * Matches tracks by their stable XML Id, detects renames, and surfaces
 * musically-meaningful changes: tracks, devices, clips, tempo, time sig, mixer.
 */

import type { DeviceSnapshot, SetSnapshot, TrackSnapshot } from "./als-parser";
import type { SetDiff, TrackDiff } from "./types";

export type { SetDiff, TrackDiff };

// ── Helpers ─────────────────────────────────────────────────────────

/** Round to avoid floating-point noise when comparing mixer values. */
function fuzzyEq(a: number, b: number, epsilon = 0.0001): boolean {
  return Math.abs(a - b) < epsilon;
}

function diffDevices(
  prev: DeviceSnapshot[],
  curr: DeviceSnapshot[]
): { added: string[]; removed: string[]; toggled: { name: string; enabled: boolean }[] } {
  const prevMap = new Map(prev.map((d) => [d.id, d]));
  const currMap = new Map(curr.map((d) => [d.id, d]));

  const added: string[] = [];
  const removed: string[] = [];
  const toggled: { name: string; enabled: boolean }[] = [];

  for (const [id, device] of currMap) {
    const prevDevice = prevMap.get(id);
    if (!prevDevice) {
      added.push(device.name);
    } else if (prevDevice.enabled !== device.enabled) {
      toggled.push({ name: device.name, enabled: device.enabled });
    }
  }
  for (const [id, device] of prevMap) {
    if (!currMap.has(id)) {
      removed.push(device.name);
    }
  }

  return { added, removed, toggled };
}

function diffClips(
  prev: string[],
  curr: string[]
): { added: string[]; removed: string[] } {
  // Clips don't have stable IDs, so we diff by name using multiset comparison
  const prevCounts = new Map<string, number>();
  const currCounts = new Map<string, number>();
  for (const n of prev) {
    prevCounts.set(n, (prevCounts.get(n) ?? 0) + 1);
  }
  for (const n of curr) {
    currCounts.set(n, (currCounts.get(n) ?? 0) + 1);
  }

  const added: string[] = [];
  const removed: string[] = [];

  for (const [name, count] of currCounts) {
    const prevCount = prevCounts.get(name) ?? 0;
    for (let i = 0; i < count - prevCount; i++) {
      added.push(name);
    }
  }
  for (const [name, count] of prevCounts) {
    const currCount = currCounts.get(name) ?? 0;
    for (let i = 0; i < count - currCount; i++) {
      removed.push(name);
    }
  }

  return { added, removed };
}

function diffMixer(prev: TrackSnapshot, curr: TrackSnapshot): string[] {
  const changes: string[] = [];
  if (!fuzzyEq(prev.volume, curr.volume)) {
    changes.push("volume");
  }
  if (!fuzzyEq(prev.pan, curr.pan)) {
    changes.push("pan");
  }
  if (prev.muted !== curr.muted) {
    changes.push(curr.muted ? "muted" : "unmuted");
  }
  if (prev.soloed !== curr.soloed) {
    changes.push(curr.soloed ? "soloed" : "unsoloed");
  }
  return changes;
}

// ── Main differ ─────────────────────────────────────────────────────

export function diffSets(prev: SetSnapshot, curr: SetSnapshot): SetDiff {
  // Tempo
  const tempoChange =
    prev.tempo === curr.tempo ? null : { from: prev.tempo, to: curr.tempo };

  // Time signature
  const timeSignatureChange =
    prev.timeSignature === curr.timeSignature
      ? null
      : { from: prev.timeSignature, to: curr.timeSignature };

  // Arrangement length
  const arrangementLengthChange =
    fuzzyEq(prev.arrangementLength, curr.arrangementLength, 0.01)
      ? null
      : { from: prev.arrangementLength, to: curr.arrangementLength };

  // Scene count
  const sceneCountChange =
    prev.sceneCount === curr.sceneCount
      ? null
      : { from: prev.sceneCount, to: curr.sceneCount };

  // Locator / cue point count
  const locatorCountChange =
    prev.locatorCount === curr.locatorCount
      ? null
      : { from: prev.locatorCount, to: curr.locatorCount };

  // Build track maps keyed by stable XML Id
  const prevTracks = new Map(prev.tracks.map((t) => [t.id, t]));
  const currTracks = new Map(curr.tracks.map((t) => [t.id, t]));

  const addedTracks: SetDiff["addedTracks"] = [];
  const removedTracks: SetDiff["removedTracks"] = [];
  const modifiedTracks: TrackDiff[] = [];

  // Detect added tracks
  for (const [id, track] of currTracks) {
    if (!prevTracks.has(id)) {
      addedTracks.push({ name: track.name, type: track.type });
    }
  }

  // Detect removed tracks
  for (const [id, track] of prevTracks) {
    if (!currTracks.has(id)) {
      removedTracks.push({ name: track.name, type: track.type });
    }
  }

  // Detect track reordering (compare order of shared track IDs)
  const prevOrder = prev.tracks.map((t) => t.id).filter((id) => currTracks.has(id));
  const currOrder = curr.tracks.map((t) => t.id).filter((id) => prevTracks.has(id));
  let tracksReordered = false;
  if (prevOrder.length === currOrder.length) {
    tracksReordered = prevOrder.some((id, i) => id !== currOrder[i]);
  }

  // Detect modified tracks (present in both)
  for (const [id, currTrack] of currTracks) {
    const prevTrack = prevTracks.get(id);
    if (!prevTrack) {
      continue;
    }

    const renamedFrom =
      prevTrack.name === currTrack.name ? undefined : prevTrack.name;
    const colorChanged = prevTrack.color !== currTrack.color;
    const { added: addedDevices, removed: removedDevices, toggled: deviceToggles } = diffDevices(
      prevTrack.devices,
      currTrack.devices
    );
    const clipCountDelta = currTrack.clipCount - prevTrack.clipCount;
    const { added: addedClips, removed: removedClips } = diffClips(
      prevTrack.clipNames,
      currTrack.clipNames
    );
    const mixerChanges = diffMixer(prevTrack, currTrack);

    // Only include if something actually changed
    const hasChanges =
      renamedFrom !== undefined ||
      colorChanged ||
      addedDevices.length > 0 ||
      removedDevices.length > 0 ||
      deviceToggles.length > 0 ||
      clipCountDelta !== 0 ||
      mixerChanges.length > 0;

    if (hasChanges) {
      modifiedTracks.push({
        name: currTrack.name,
        type: currTrack.type,
        renamedFrom,
        colorChanged,
        addedDevices,
        removedDevices,
        deviceToggles,
        clipCountDelta,
        addedClips,
        removedClips,
        mixerChanges,
      });
    }
  }

  return {
    tempoChange,
    timeSignatureChange,
    arrangementLengthChange,
    sceneCountChange,
    locatorCountChange,
    addedTracks,
    removedTracks,
    modifiedTracks,
    tracksReordered,
  };
}

/** Returns true if the diff contains no meaningful changes. */
export function isEmptyDiff(diff: SetDiff): boolean {
  return (
    diff.tempoChange === null &&
    diff.timeSignatureChange === null &&
    diff.arrangementLengthChange === null &&
    diff.sceneCountChange === null &&
    diff.locatorCountChange === null &&
    !diff.tracksReordered &&
    diff.addedTracks.length === 0 &&
    diff.removedTracks.length === 0 &&
    diff.modifiedTracks.length === 0
  );
}
