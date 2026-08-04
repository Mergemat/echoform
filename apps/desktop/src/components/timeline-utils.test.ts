import { describe, expect, it } from "vitest";
import type { Idea, Project, Save } from "@/lib/types";
import type { SetDiff } from "../../../../packages/server/src/types";
import {
  buildChips,
  buildTimelineDisplayItems,
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
    ...fields,
  };
}

function makeSave(id: string, ideaId: string, createdAt: string): Save {
  return {
    id,
    label: id,
    note: "",
    pinned: false,
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
  it("shows only the focused set's checkpoints, newest first", () => {
    const mainIdea = makeIdea("idea-main", {
      name: "Main",
      baseSaveId: "save-1",
      headSaveId: "save-2",
    });
    const secondIdea = makeIdea("idea-second", {
      name: "Alternate mix",
      baseSaveId: "save-3",
      headSaveId: "save-3",
      setPath: "alternate-mix.als",
    });
    const saves = [
      makeSave("save-1", "idea-main", "2024-01-01T00:00:00Z"),
      makeSave("save-2", "idea-main", "2024-01-02T00:00:00Z"),
      makeSave("save-3", "idea-second", "2024-01-03T00:00:00Z"),
    ];
    const project: Project = {
      id: "proj-1",
      name: "Demo",
      adapter: "ableton",
      continuedFrom: null,
      projectPath: "/tmp/demo",
      rootIds: [],
      presence: "active",
      watchError: null,
      lastSeenAt: "2024-01-03T00:00:00Z",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-03T00:00:00Z",
      currentIdeaId: "idea-second",
      pendingOpen: null,
      driftStatus: null,
      ideas: [mainIdea, secondIdea],
      saves,
      watching: true,
    };

    const currentItems = buildTimelineDisplayItems(project, null, new Set());
    expect(currentItems).toHaveLength(1);
    expect(currentItems[0]?.idea.id).toBe("idea-second");
    expect(currentItems[0]?.type === "save" && currentItems[0].save.id).toBe(
      "save-3"
    );

    const mainItems = buildTimelineDisplayItems(
      project,
      "idea-main",
      new Set()
    );
    expect(
      mainItems.map((item) => item.type === "save" && item.save.id)
    ).toEqual(["save-2", "save-1"]);
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

function makeSaveWithDiff(setDiff?: SetDiff, changes?: Save["changes"]): Save {
  return {
    id: "save-bc",
    label: "old save",
    note: "",
    pinned: false,
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

describe("buildChips", () => {
  it("uses file changes when semantic set analysis is absent", () => {
    const save = makeSaveWithDiff(undefined, {
      addedFiles: ["Samples/kick.wav"],
      modifiedFiles: [],
      removedFiles: [],
      sizeDelta: 1024,
    });

    expect(buildChips(save)).toEqual([{ label: "+1 file", kind: "add" }]);
  });

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
