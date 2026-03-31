import { describe, expect, it } from "vitest";
import type { Idea, Project, Save } from "@/lib/types";
import type {
  SetDiff,
  TrackDiff,
} from "../../../../packages/server/src/types";
import {
  buildChips,
  buildTimelineDisplayItems,
  getRootFileGroups,
  getSaveDisplayTitle,
} from "./timeline-utils";

function makeIdea(id: string, fields: Partial<Idea> = {}): Idea {
  return {
    id,
    name: id,
    createdAt: "2024-01-01T00:00:00Z",
    setPath: "song.als",
    baseSaveId: "",
    headSaveId: "",
    parentIdeaId: null,
    forkedFromSaveId: null,
    ...fields,
  };
}

function makeSave(id: string, ideaId: string, createdAt: string): Save {
  return {
    id,
    label: id,
    note: "",
    createdAt,
    ideaId,
    previewRefs: [],
    previewStatus: "none",
    previewMime: null,
    previewRequestedAt: null,
    previewUpdatedAt: null,
    projectHash: id,
    auto: false,
    metadata: {
      activeSetPath: "song.als",
      setFiles: ["song.als"],
      audioFiles: 0,
      fileCount: 1,
      sizeBytes: 100,
      modifiedAt: createdAt,
    },
  };
}

describe("buildTimelineDisplayItems", () => {
  it("inserts child branches directly after their fork save", () => {
    const mainIdea = makeIdea("idea-main", {
      name: "Main",
      baseSaveId: "save-1",
      headSaveId: "save-2",
    });
    const childIdea = makeIdea("idea-child", {
      name: "Recovered bass",
      baseSaveId: "save-1",
      headSaveId: "save-3",
      parentIdeaId: "idea-main",
      forkedFromSaveId: "save-1",
    });
    const saves = [
      makeSave("save-1", "idea-main", "2024-01-01T00:00:00Z"),
      makeSave("save-2", "idea-main", "2024-01-02T00:00:00Z"),
      makeSave("save-3", "idea-child", "2024-01-03T00:00:00Z"),
    ];
    const project: Project = {
      id: "proj-1",
      name: "Demo",
      adapter: "ableton",
      projectPath: "/tmp/demo",
      rootIds: [],
      presence: "active",
      watchError: null,
      lastSeenAt: "2024-01-03T00:00:00Z",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-03T00:00:00Z",
      currentIdeaId: "idea-child",
      pendingOpen: null,
      driftStatus: null,
      ideas: [mainIdea, childIdea],
      saves,
      watching: true,
    };

    const items = buildTimelineDisplayItems(project, null, new Set());
    expect(items.map((item) => item.type)).toEqual([
      "branch",
      "save",
      "save",
      "branch",
      "save",
    ]);

    const [rootBranch, newestMainSave, forkSave, childBranch, childSave] =
      items;
    expect(rootBranch.type === "branch" && rootBranch.idea.id).toBe(
      "idea-main"
    );
    expect(newestMainSave.type === "save" && newestMainSave.save.id).toBe(
      "save-2"
    );
    expect(forkSave.type === "save" && forkSave.save.id).toBe("save-1");
    expect(childBranch.type === "branch" && childBranch.idea.id).toBe(
      "idea-child"
    );
    expect(childBranch.type === "branch" && childBranch.depth).toBe(1);
    expect(childSave.type === "save" && childSave.save.id).toBe("save-3");
  });
});

describe("getRootFileGroups", () => {
  it("dedupes duplicate root ideas that point at the same set file", () => {
    const project: Project = {
      id: "proj-1",
      name: "Demo",
      adapter: "ableton",
      projectPath: "/tmp/demo",
      rootIds: [],
      presence: "active",
      watchError: null,
      lastSeenAt: "2024-01-03T00:00:00Z",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-03T00:00:00Z",
      currentIdeaId: "idea-main",
      pendingOpen: null,
      driftStatus: null,
      ideas: [
        makeIdea("idea-main", {
          name: "quick night",
          setPath: "quick-night-vocal.als",
        }),
        makeIdea("idea-dup-1", {
          name: "quick night 2",
          setPath: "quick-night-vocal.als",
        }),
        makeIdea("idea-dup-2", {
          name: "quick night 3",
          setPath: "quick-night-vocal.als",
        }),
        makeIdea("idea-other", {
          name: "quick night 4",
          setPath: "quick night.als",
        }),
      ],
      saves: [],
      watching: true,
    };

    const groups = getRootFileGroups(project);

    expect(groups).toHaveLength(2);
    expect(
      groups.find((group) => group.setPath === "quick-night-vocal.als")
        ?.rootIdeas
    ).toHaveLength(3);
    expect(
      groups.find((group) => group.setPath === "quick night.als")?.rootIdeas
    ).toHaveLength(1);
  });
});

describe("getSaveDisplayTitle", () => {
  it("prefers a custom label when present", () => {
    expect(
      getSaveDisplayTitle({
        label: "Chorus bounce",
        customLabel: true,
        createdAt: "2024-01-03T14:45:00Z",
      })
    ).toBe("Chorus bounce");
  });

  it("falls back to a timestamp when the label is not custom", () => {
    expect(
      getSaveDisplayTitle({
        label: "3 files changed",
        createdAt: "2024-01-03T14:45:00Z",
      })
    ).not.toBe("3 files changed");
  });
});

// ── Backward compatibility: old saved data with missing fields ──────

/**
 * Simulates a TrackDiff from old persisted data that lacks fields added later
 * (deviceToggles, colorChanged, renamedFrom). The type system says these are
 * optional, but code that does `.length` on undefined will crash.
 */
function legacyTrackDiff(overrides: Partial<TrackDiff> = {}): TrackDiff {
  return {
    name: "Bass",
    type: "audio",
    addedClips: [],
    removedClips: [],
    addedDevices: [],
    removedDevices: [],
    clipCountDelta: 0,
    mixerChanges: [],
    // intentionally omit: deviceToggles, colorChanged, renamedFrom
    ...overrides,
  } as TrackDiff;
}

/**
 * Simulates a SetDiff from old persisted data that lacks fields added later
 * (arrangementLengthChange, sceneCountChange, locatorCountChange, tracksReordered).
 */
function legacySetDiff(overrides: Partial<SetDiff> = {}): SetDiff {
  return {
    tempoChange: null,
    timeSignatureChange: null,
    addedTracks: [],
    removedTracks: [],
    modifiedTracks: [],
    // intentionally omit: arrangementLengthChange, sceneCountChange,
    //                      locatorCountChange, tracksReordered
    ...overrides,
  } as SetDiff;
}

function makeSaveWithDiff(
  setDiff?: SetDiff,
  changes?: Save["changes"]
): Save {
  return {
    id: "save-bc",
    label: "old save",
    note: "",
    createdAt: "2024-01-01T00:00:00Z",
    ideaId: "idea-1",
    previewRefs: [],
    previewStatus: "none",
    previewMime: null,
    previewRequestedAt: null,
    previewUpdatedAt: null,
    projectHash: "abc",
    auto: false,
    setDiff,
    changes,
    metadata: {
      activeSetPath: "song.als",
      setFiles: ["song.als"],
      audioFiles: 0,
      fileCount: 1,
      sizeBytes: 100,
      modifiedAt: "2024-01-01T00:00:00Z",
    },
  };
}

describe("buildChips – backward compatibility with old saved data", () => {
  it("does not crash when TrackDiff is missing deviceToggles", () => {
    const save = makeSaveWithDiff(
      legacySetDiff({
        modifiedTracks: [legacyTrackDiff({ addedDevices: ["Compressor"] })],
      })
    );
    const chips = buildChips(save);
    expect(chips.some((c) => c.label.includes("device"))).toBe(true);
  });

  it("does not crash when TrackDiff is missing colorChanged", () => {
    const save = makeSaveWithDiff(
      legacySetDiff({
        modifiedTracks: [legacyTrackDiff({ clipCountDelta: 3 })],
      })
    );
    const chips = buildChips(save);
    expect(chips.some((c) => c.label.includes("clip"))).toBe(true);
    // should not produce a "recolored" chip
    expect(chips.some((c) => c.label.includes("recolored"))).toBe(false);
  });

  it("does not crash when TrackDiff is missing renamedFrom", () => {
    const save = makeSaveWithDiff(
      legacySetDiff({
        modifiedTracks: [legacyTrackDiff({ mixerChanges: ["volume"] })],
      })
    );
    const chips = buildChips(save);
    expect(chips.some((c) => c.label === "mixer changes")).toBe(true);
  });

  it("does not crash when SetDiff is missing arrangementLengthChange", () => {
    const save = makeSaveWithDiff(
      legacySetDiff({ tempoChange: { from: 120, to: 130 } })
    );
    const chips = buildChips(save);
    expect(chips.some((c) => c.label.includes("bpm"))).toBe(true);
    // should not crash or produce bar chips
    expect(chips.some((c) => c.label.includes("bar"))).toBe(false);
  });

  it("does not crash when SetDiff is missing sceneCountChange and locatorCountChange", () => {
    const save = makeSaveWithDiff(
      legacySetDiff({
        addedTracks: [{ name: "Synth", type: "midi" }],
      })
    );
    const chips = buildChips(save);
    expect(chips.some((c) => c.label.includes("MIDI"))).toBe(true);
    expect(chips.some((c) => c.label.includes("scene"))).toBe(false);
    expect(chips.some((c) => c.label.includes("locator"))).toBe(false);
  });

  it("does not crash when SetDiff is missing tracksReordered", () => {
    const save = makeSaveWithDiff(
      legacySetDiff({
        removedTracks: [{ name: "Pad", type: "audio" }],
      })
    );
    const chips = buildChips(save);
    expect(chips.some((c) => c.label.includes("Audio"))).toBe(true);
    expect(chips.some((c) => c.label.includes("reordered"))).toBe(false);
  });

  it("handles a fully minimal legacy SetDiff with no optional fields", () => {
    const save = makeSaveWithDiff(legacySetDiff());
    const chips = buildChips(save);
    expect(chips).toEqual([]);
  });

  it("handles a save with no setDiff at all (pre-diff era)", () => {
    const save = makeSaveWithDiff(undefined);
    const chips = buildChips(save);
    expect(chips).toEqual([]);
  });

  it("handles a save with changes but no setDiff", () => {
    const save = makeSaveWithDiff(undefined, {
      addedFiles: ["Samples/kick.wav"],
      modifiedFiles: [],
      removedFiles: [],
      sizeDelta: 1024,
    });
    const chips = buildChips(save);
    expect(chips).toEqual([{ label: "+1 file", kind: "add" }]);
  });

  it("handles multiple legacy TrackDiffs in one SetDiff without crashing", () => {
    const save = makeSaveWithDiff(
      legacySetDiff({
        modifiedTracks: [
          legacyTrackDiff({
            name: "Kick",
            clipCountDelta: 2,
            addedDevices: ["Saturator"],
          }),
          legacyTrackDiff({
            name: "Snare",
            clipCountDelta: -1,
            removedDevices: ["EQ Eight"],
            mixerChanges: ["pan"],
          }),
          legacyTrackDiff({
            name: "HiHat",
            clipCountDelta: 0,
          }),
        ],
      })
    );
    const chips = buildChips(save);
    expect(chips.some((c) => c.label.includes("clip"))).toBe(true);
    expect(chips.some((c) => c.label === "mixer changes")).toBe(true);
  });
});

describe("buildChips – current data with all fields present", () => {
  it("produces chips for tempo, tracks, devices, clips, mixer, color, toggles, arrangement, scenes, locators, reorder", () => {
    const save = makeSaveWithDiff({
      tempoChange: { from: 120, to: 128 },
      timeSignatureChange: { from: "4/4", to: "3/4" },
      addedTracks: [{ name: "Lead", type: "midi" }],
      removedTracks: [{ name: "Old Pad", type: "audio" }],
      modifiedTracks: [
        {
          name: "Bass",
          type: "audio",
          addedClips: ["clip-1"],
          removedClips: [],
          addedDevices: ["Compressor"],
          removedDevices: [],
          clipCountDelta: 1,
          mixerChanges: ["volume"],
          colorChanged: true,
          deviceToggles: [{ name: "EQ Eight", enabled: false }],
          renamedFrom: "Old Bass",
        },
      ],
      arrangementLengthChange: { from: 64, to: 128 },
      sceneCountChange: { from: 8, to: 10 },
      locatorCountChange: { from: 2, to: 4 },
      tracksReordered: true,
    });
    const chips = buildChips(save);
    const labels = chips.map((c) => c.label);

    expect(labels).toContain("120→128 bpm");
    expect(labels).toContain("4/4→3/4");
    expect(labels.some((l) => l.includes("MIDI"))).toBe(true);
    expect(labels.some((l) => l.includes("Audio"))).toBe(true);
    expect(labels.some((l) => l.includes("Old Bass"))).toBe(true);
    expect(labels.some((l) => l.includes("device"))).toBe(true);
    expect(labels.some((l) => l.includes("clip"))).toBe(true);
    expect(labels).toContain("mixer changes");
    expect(labels.some((l) => l.includes("recolored"))).toBe(true);
    expect(labels.some((l) => l.includes("toggled"))).toBe(true);
    expect(labels.some((l) => l.includes("bar"))).toBe(true);
    expect(labels.some((l) => l.includes("scene"))).toBe(true);
    expect(labels.some((l) => l.includes("locator"))).toBe(true);
    expect(labels).toContain("tracks reordered");
  });
});
