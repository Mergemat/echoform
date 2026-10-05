import { describe, expect, it } from "vitest";
import type { Idea, Project, Save } from "@/lib/types";
import {
  buildTimelineDisplayItems,
  buildTimelineSections,
  getSaveDisplayTitle,
} from "./timeline-utils";

function makeIdea(id: string, fields: Partial<Idea> = {}): Idea {
  return {
    baseSaveId: "",
    createdAt: "2024-01-01T00:00:00Z",
    headSaveId: "",
    id,
    name: id,
    setPath: "song.als",
    ...fields,
  };
}

function makeSave(id: string, ideaId: string, createdAt: string): Save {
  return {
    auto: false,
    createdAt,
    id,
    ideaId,
    label: id,
    metadata: {
      activeSetPath: "song.als",
      audioFiles: 0,
      fileCount: 1,
      modifiedAt: createdAt,
      setFiles: ["song.als"],
      sizeBytes: 100,
    },
    note: "",
    pinned: false,
    previewMime: null,
    previewRefs: [],
    previewRequestedAt: null,
    previewStatus: "none",
    previewUpdatedAt: null,
    projectHash: id,
  };
}

describe("buildTimelineDisplayItems", () => {
  it("shows only the focused set's checkpoints, newest first", () => {
    const mainIdea = makeIdea("idea-main", {
      baseSaveId: "save-1",
      headSaveId: "save-2",
      name: "Main",
    });
    const secondIdea = makeIdea("idea-second", {
      baseSaveId: "save-3",
      headSaveId: "save-3",
      name: "Alternate mix",
      setPath: "alternate-mix.als",
    });
    const saves = [
      makeSave("save-1", "idea-main", "2024-01-01T00:00:00Z"),
      makeSave("save-2", "idea-main", "2024-01-02T00:00:00Z"),
      makeSave("save-3", "idea-second", "2024-01-03T00:00:00Z"),
    ];
    const project: Project = {
      adapter: "ableton",
      continuedFrom: null,
      createdAt: "2024-01-01T00:00:00Z",
      currentIdeaId: "idea-second",
      driftStatus: null,
      id: "proj-1",
      ideas: [mainIdea, secondIdea],
      lastSeenAt: "2024-01-03T00:00:00Z",
      name: "Demo",
      pendingOpen: null,
      presence: "active",
      projectPath: "/tmp/demo",
      rootIds: [],
      saves,
      updatedAt: "2024-01-03T00:00:00Z",
      watchError: null,
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
        createdAt: "2024-01-03T14:45:00Z",
        customLabel: true,
        label: "Chorus bounce",
      })
    ).toBe("Chorus bounce");
  });

  it("falls back to a timestamp when the label is not custom", () => {
    expect(
      getSaveDisplayTitle({
        createdAt: "2024-01-03T14:45:00Z",
        label: "3 files changed",
      })
    ).not.toBe("3 files changed");
  });
});

describe("buildTimelineSections", () => {
  const idea = makeIdea("idea-1", { baseSaveId: "s1", headSaveId: "s5" });

  function minorSave(
    id: string,
    createdAt: string,
    fields: Partial<Save> = {}
  ) {
    return {
      ...makeSave(id, idea.id, createdAt),
      auto: true,
      summary: {
        baseSaveId: null,
        beatsPerBar: 4,
        first: false,
        headline: "Saved with no musical changes",
        lengthBeats: 64,
        regions: [],
        shape: [],
        touched: [],
        trackCount: 4,
        version: 1,
        weight: "none" as const,
      },
      ...fields,
    };
  }

  function makeProject(saves: Save[]): Project {
    return {
      adapter: "ableton",
      continuedFrom: null,
      createdAt: "2026-03-25T08:00:00",
      currentIdeaId: idea.id,
      driftStatus: null,
      id: "proj-1",
      ideas: [idea],
      lastSeenAt: null,
      name: "Demo",
      pendingOpen: null,
      presence: "active",
      projectPath: "/tmp/demo",
      rootIds: [],
      saves,
      updatedAt: "2026-03-25T08:00:00",
      watchError: null,
      watching: true,
    };
  }

  const now = new Date("2026-03-25T23:00:00");

  it("never hides the latest, first, or user-annotated checkpoints in a group", () => {
    const project = makeProject([
      minorSave("s1", "2026-03-25T10:00:00"),
      minorSave("s2", "2026-03-25T10:05:00", { note: "keep the snare" }),
      minorSave("s3", "2026-03-25T10:10:00", { pinned: true }),
      minorSave("s4", "2026-03-25T10:15:00", {
        customLabel: true,
        label: "Drop v2",
      }),
      minorSave("s5", "2026-03-25T10:20:00"),
    ]);

    const [section] = buildTimelineSections(project, null, new Set(), now);

    expect(section?.items.map((item) => item.type)).toEqual([
      "save",
      "save",
      "save",
      "save",
      "save",
    ]);
  });

  it("collapses runs of minor saves and keeps the group header when expanded", () => {
    const project = makeProject([
      minorSave("s1", "2026-03-25T10:00:00"),
      minorSave("s2", "2026-03-25T10:05:00"),
      minorSave("s3", "2026-03-25T10:10:00"),
      minorSave("s4", "2026-03-25T10:15:00"),
      minorSave("s5", "2026-03-25T10:20:00"),
    ]);

    const collapsed = buildTimelineSections(project, null, new Set(), now)[0];
    expect(collapsed?.items).toHaveLength(3);
    const group = collapsed?.items[1];
    expect(group?.type === "group" && group.saves.map((s) => s.id)).toEqual([
      "s4",
      "s3",
      "s2",
    ]);

    const expanded = buildTimelineSections(
      project,
      null,
      new Set(["s4"]),
      now
    )[0];
    expect(
      expanded?.items.map((item) =>
        item.type === "group" ? `group:${item.expanded}` : item.save.id
      )
    ).toEqual(["s5", "group:true", "s4", "s3", "s2", "s1"]);
  });

  it("splits checkpoints into calendar days, newest first", () => {
    const project = makeProject([
      makeSave("s1", idea.id, "2026-03-24T22:00:00"),
      makeSave("s5", idea.id, "2026-03-25T09:00:00"),
    ]);

    const sections = buildTimelineSections(project, null, new Set(), now);

    expect(sections.map((section) => section.label)).toEqual([
      "Today",
      "Yesterday",
    ]);
  });
});
