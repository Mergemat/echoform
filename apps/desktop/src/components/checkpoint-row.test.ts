import { describe, expect, it } from "vitest";
import type { Save } from "@/lib/types";
import { matchesSearch } from "./checkpoint-row";

function save(changes: string[], fields: Partial<Save> = {}): Save {
  return {
    auto: true,
    createdAt: "2026-01-16T13:52:00.000Z",
    id: "s",
    ideaId: "i",
    label: "",
    metadata: {
      activeSetPath: "song.als",
      audioFiles: 0,
      fileCount: 1,
      modifiedAt: "2026-01-16T13:52:00.000Z",
      setFiles: ["song.als"],
      sizeBytes: 1,
    },
    note: "",
    pinned: false,
    previewMime: null,
    previewRefs: [],
    previewRequestedAt: null,
    previewStatus: "none",
    previewUpdatedAt: null,
    projectHash: "h",
    summary: {
      baseSaveId: null,
      beatsPerBar: 4,
      changes,
      first: false,
      headline: changes[0] ?? "No musical changes",
      lengthBeats: 64,
      regions: [],
      shape: [],
      touched: [{ color: 1, name: "Sub Bass" }],
      trackCount: 4,
      version: 2,
      weight: changes.length > 0 ? "major" : "none",
    },
    ...fields,
  };
}

describe("finding a change", () => {
  const quieter = save([
    "Serum 2: new part in bars 5–20",
    "Sub Bass quieter (−3.0 dB)",
  ]);

  it("matches any change, not just the headline", () => {
    expect(matchesSearch(quieter, "quieter")).toBe(true);
    expect(matchesSearch(quieter, "bass quieter")).toBe(true);
  });

  it("requires every word to match", () => {
    expect(matchesSearch(quieter, "bass louder")).toBe(false);
  });

  it("matches the user's own name and note", () => {
    const named = save([], {
      customLabel: true,
      label: "Drop v2",
      note: "try the pad up",
    });
    expect(matchesSearch(named, "drop")).toBe(true);
    expect(matchesSearch(named, "pad")).toBe(true);
  });
});
