import { describe, expect, test } from "bun:test";
import { parseLiveSetXml } from "./live-set";
import { analyzeSets, formatBars } from "./set-compare";
import { alsXml, type FixtureSet, type FixtureTrack } from "./test-support/als";

const drums: FixtureTrack = {
  clips: [
    { end: 16, sample: "kick.wav", start: 0 },
    { end: 32, sample: "kick.wav", start: 16 },
  ],
  id: "10",
  name: "1-Drums",
  type: "audio",
};

const lead: FixtureTrack = {
  clips: [
    {
      end: 16,
      notes: [
        { key: 60, time: 0 },
        { key: 64, time: 1 },
      ],
      start: 0,
    },
  ],
  devices: [{ id: "100", params: { Feedback: 0.5 }, tag: "Echo" }],
  id: "20",
  name: "2-Lead",
  type: "midi",
};

function set(fields: Partial<FixtureSet> = {}): FixtureSet {
  return { tempo: 120, tracks: [drums, lead], ...fields };
}

function analyze(before: FixtureSet | null, after: FixtureSet) {
  return analyzeSets(
    before ? parseLiveSetXml(alsXml(before)) : null,
    parseLiveSetXml(alsXml(after)),
    before ? "previous" : null,
  );
}

function withTrack(fixture: FixtureSet, id: string, patch: Partial<FixtureTrack>) {
  return {
    ...fixture,
    tracks: fixture.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  };
}

describe("reading a Live Set", () => {
  test("finds arrangement clips on audio tracks", () => {
    const parsed = parseLiveSetXml(alsXml(set()));
    expect(parsed.tracks[0]?.clips.map((c) => [c.start, c.end, c.sample])).toEqual([
      [0, 16, "kick.wav"],
      [16, 32, "kick.wav"],
    ]);
  });

  test("converts fader gain to dB", () => {
    const parsed = parseLiveSetXml(
      alsXml(withTrack(set(), "10", { volume: 0.707_945_8 })),
    );
    expect(parsed.tracks[0]?.mixer.volumeDb).toBe(-3);
  });
});

describe("comparing versions", () => {
  test("describes the first checkpoint by its shape", () => {
    const result = analyze(null, set());
    expect(result.summary.first).toBe(true);
    expect(result.summary.headline).toBe("First save · 2 tracks, 8 bars at 120 BPM");
    expect(result.summary.shape.some((v) => v > 0)).toBe(true);
  });

  test("reports an unchanged save as having no musical changes", () => {
    const result = analyze(set(), set());
    expect(result.summary.weight).toBe("none");
    expect(result.summary.headline).toBe("No musical changes");
    expect(result.summary.regions).toEqual([]);
  });

  test("locates a new part in bars", () => {
    const after = withTrack(set(), "20", {
      clips: [
        ...(lead.clips ?? []),
        { end: 32, notes: [{ key: 67, time: 0 }], start: 16 },
      ],
    });
    const result = analyze(set(), after);
    expect(result.summary.weight).toBe("major");
    expect(result.summary.headline).toBe("Lead: new part in bars 5–8");
    expect(result.summary.regions).toEqual([{ color: 0, end: 32, start: 16 }]);
    const added = result.tracks[1]?.clips.find((c) => c.status === "added");
    expect(added?.notes?.added).toEqual([{ d: 1, k: 67, t: 0 }]);
  });

  test("shows which notes changed inside an edited clip", () => {
    const after = withTrack(set(), "20", {
      clips: [
        {
          end: 16,
          notes: [
            { key: 60, time: 0 },
            { key: 65, time: 2 },
          ],
          start: 0,
        },
      ],
    });
    const clip = analyze(set(), after).tracks[1]?.clips[0];
    expect(clip?.status).toBe("edited");
    expect(clip?.notes).toEqual({
      added: [{ d: 1, k: 65, t: 2 }],
      kept: [{ d: 1, k: 60, t: 0 }],
      removed: [{ d: 1, k: 64, t: 1 }],
    });
  });

  test("names device and mixer changes", () => {
    const after = withTrack(set(), "20", {
      devices: [
        { enabled: false, id: "100", params: { Feedback: 0.8 }, tag: "Echo" },
        { id: "101", tag: "Eq8" },
      ],
      volume: 0.5,
    });
    const changes = analyze(set(), after).tracks[1]?.changes;
    expect(changes).toContainEqual({ device: "Echo", type: "device-off" });
    expect(changes).toContainEqual({
      device: "Echo",
      params: [{ from: 0.5, name: "Feedback", to: 0.8 }],
      type: "device-settings",
    });
    expect(changes).toContainEqual({ device: "EQ Eight", type: "device-added" });
    expect(changes).toContainEqual({ from: 0, to: -6, type: "volume" });
  });

  test("lists every change in searchable words", () => {
    const after = withTrack(set({ tempo: 128 }), "20", { volume: 0.5 });
    const summary = analyze(set(), after).summary;
    expect(summary.headline).toBe("Tempo 120 → 128 BPM");
    expect(summary.changes).toEqual(["Tempo 120 → 128 BPM", "Lead quieter (−6.0 dB)"]);
  });

  test("tells moved clips from new ones", () => {
    const after = withTrack(set(), "20", {
      clips: [{ ...lead.clips![0]!, end: 48, start: 32 }],
    });
    const clip = analyze(set(), after).tracks[1]?.clips[0];
    expect(clip?.status).toBe("moved");
    expect(clip?.movedFrom).toBe(0);
  });

  test("a tempo change alone does not mark audio clips as edited", () => {
    const after = withTrack(set({ tempo: 140 }), "10", {
      clips: [
        { end: 14.5, loopEnd: 16, sample: "kick.wav", start: 0 },
        { end: 30.5, loopEnd: 16, sample: "kick.wav", start: 16 },
      ],
    });
    const result = analyze(set(), after);
    expect(result.summary.headline).toBe("Tempo 120 → 140 BPM");
    expect(result.tracks[0]?.clips.every((c) => c.status === "same")).toBe(true);
  });

  test("ignores Live renumbering default track names", () => {
    const after = withTrack(set(), "10", { name: "3-Drums" });
    expect(analyze(set(), after).summary.weight).toBe("none");
  });

  test("keeps removed tracks visible as removed", () => {
    const result = analyze(set(), set({ tracks: [drums] }));
    expect(result.summary.headline).toBe("Removed Lead");
    expect(result.tracks.at(-1)?.status).toBe("removed");
  });
});

test("formats bar ranges", () => {
  expect(formatBars(0, 4, 4)).toBe("bar 1");
  expect(formatBars(16, 32, 4)).toBe("bars 5–8");
});
