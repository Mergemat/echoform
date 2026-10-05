import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  StateRepository,
  StateRepositoryError,
  type FileOperations,
} from "./state-repository";
import type { AppState } from "./types";

const roots: string[] = [];

function state(message?: string): AppState {
  return {
    roots: [],
    projects: [],
    activity: message
      ? [
          {
            id: `activity-${message}`,
            kind: "root-added",
            message,
            severity: "info",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]
      : [],
  };
}

function stateWithAnalysis(message: string): AppState {
  const createdAt = "2026-01-01T00:00:00.000Z";
  return {
    roots: [],
    activity: [
      {
        id: `activity-${message}`,
        kind: "root-added",
        message,
        severity: "info",
        createdAt,
      },
    ],
    projects: [
      {
        adapter: "ableton",
        continuedFrom: null,
        createdAt,
        currentIdeaId: "idea-1",
        driftStatus: null,
        id: "project-1",
        ideas: [
          {
            baseSaveId: "save-1",
            createdAt,
            headSaveId: "save-1",
            id: "idea-1",
            name: "Song",
            setPath: "song.als",
          },
        ],
        lastSeenAt: createdAt,
        name: "Project",
        pendingOpen: null,
        presence: "active",
        projectPath: "/project",
        rootIds: [],
        saves: [
          {
            auto: false,
            changes: {
              addedFiles: [],
              modifiedFiles: ["song.als"],
              removedFiles: [],
              sizeDelta: 2,
            },
            createdAt,
            customLabel: true,
            id: "save-1",
            ideaId: "idea-1",
            label: "Save",
            metadata: {
              activeSetPath: "song.als",
              audioFiles: 0,
              fileCount: 1,
              modifiedAt: createdAt,
              setFiles: ["song.als"],
              sizeBytes: 10,
            },
            note: "",
            pinned: false,
            previewMime: null,
            previewRefs: [],
            previewRequestedAt: null,
            previewStatus: "none",
            previewUpdatedAt: null,
            projectHash: "hash",
            summary: {
              baseSaveId: null,
              beatsPerBar: 4,
              first: true,
              headline: "1 tracks · 4 bars at 120 BPM",
              lengthBeats: 16,
              regions: [],
              shape: [1],
              touched: [],
              trackCount: 1,
              version: 1,
              weight: "major",
            },
          },
        ],
        updatedAt: createdAt,
        watchError: null,
        watching: true,
      },
    ],
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("StateRepository", () => {
  test("distinguishes a read I/O error from missing state", async () => {
    const root = await mkdtemp(join(tmpdir(), "echoform-state-repo-"));
    roots.push(root);
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    const files: FileOperations = {
      mkdir,
      readFile: (async () => {
        throw denied;
      }) as FileOperations["readFile"],
      rename,
      rm,
      writeFile,
    };

    await expect(
      new StateRepository(root, files).load(),
    ).rejects.toBeInstanceOf(StateRepositoryError);
  });

  test("restores the prior generation when promotion fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "echoform-state-repo-"));
    roots.push(root);
    const repository = new StateRepository(root);
    await repository.save(state("first"));

    const files: FileOperations = {
      mkdir,
      readFile,
      rename: (async (
        from: Parameters<typeof rename>[0],
        to: Parameters<typeof rename>[1],
      ) => {
        if (String(from).endsWith("state.next.json")) {
          throw new Error("injected promotion failure");
        }
        return rename(from, to);
      }) as FileOperations["rename"],
      rm,
      writeFile,
    };

    await expect(
      new StateRepository(root, files).save(state("second")),
    ).rejects.toThrow("injected promotion failure");
    expect((await repository.load()).state.activity[0]?.message).toBe("first");
    expect(await readFile(join(root, "state.json"), "utf8")).toContain("first");
  });

  test("loads keep seeing the current generation while a save is promoting", async () => {
    const root = await mkdtemp(join(tmpdir(), "echoform-state-repo-"));
    roots.push(root);
    const repository = new StateRepository(root);
    await repository.save(state("first"));
    let releasePromotion!: () => void;
    const promotionReleased = new Promise<void>((resolve) => {
      releasePromotion = resolve;
    });
    let promotionReached!: () => void;
    const atPromotion = new Promise<void>((resolve) => {
      promotionReached = resolve;
    });
    const files: FileOperations = {
      mkdir,
      readFile,
      rename: (async (
        from: Parameters<typeof rename>[0],
        to: Parameters<typeof rename>[1],
      ) => {
        if (String(from).endsWith("state.next.json")) {
          promotionReached();
          await promotionReleased;
        }
        return rename(from, to);
      }) as FileOperations["rename"],
      rm,
      writeFile,
    };
    const saving = new StateRepository(root, files).save(state("second"));
    await atPromotion;

    const during = await repository.load();
    expect(during.recoveredFromPrevious).toBe(false);
    expect(during.state.activity[0]?.message).toBe("first");

    releasePromotion();
    await saving;
    expect((await repository.load()).state.activity[0]?.message).toBe("second");
  });

  test("drops pre-v1 analysis fields when loading older state", async () => {
    const root = await mkdtemp(join(tmpdir(), "echoform-state-repo-"));
    roots.push(root);
    const legacy = stateWithAnalysis("legacy");
    const save = legacy.projects[0]!.saves[0] as any;
    delete save.summary;
    save.setDiff = { addedTracks: [] };
    save.trackSummary = [];
    await writeFile(join(root, "state.json"), JSON.stringify(legacy));

    const loaded = await new StateRepository(root).load();

    const loadedSave = loaded.state.projects[0]!.saves[0] as any;
    expect(loadedSave.setDiff).toBeUndefined();
    expect(loadedSave.trackSummary).toBeUndefined();
  });

  test("rejects semantically invalid activity and recovers the previous state", async () => {
    const root = await mkdtemp(join(tmpdir(), "echoform-state-repo-"));
    roots.push(root);
    const repository = new StateRepository(root);
    await repository.save(state("valid previous"));
    await repository.save(state("current"));
    const invalid = state("invalid");
    (invalid.activity[0] as any).severity = "panic";
    await writeFile(join(root, "state.json"), JSON.stringify(invalid));

    const loaded = await repository.load();

    expect(loaded.recoveredFromPrevious).toBe(true);
    expect(loaded.state.activity[0]?.message).toBe("valid previous");
  });

  test("quarantines an incompatible lone state and starts clean", async () => {
    const root = await mkdtemp(join(tmpdir(), "echoform-state-repo-"));
    roots.push(root);
    const incompatible = JSON.stringify({ projects: "old schema" });
    await writeFile(join(root, "state.json"), incompatible);

    const loaded = await new StateRepository(root).load();
    const files = await readdir(root);
    const quarantine = files.find((file) =>
      file.startsWith("state.incompatible.current."),
    );

    expect(loaded.recoveredFromPrevious).toBe(false);
    expect(loaded.state.projects).toEqual([]);
    expect(loaded.state.activity[0]?.severity).toBe("warning");
    expect(loaded.state.activity[0]?.message).toContain(
      "started with empty history metadata",
    );
    expect(quarantine).toBeTruthy();
    expect(await readFile(join(root, quarantine!), "utf8")).toBe(incompatible);
    await expect(readFile(join(root, "state.json"), "utf8")).rejects.toThrow();
  });

  test("quarantines both invalid generations instead of overwriting either", async () => {
    const root = await mkdtemp(join(tmpdir(), "echoform-state-repo-"));
    roots.push(root);
    await writeFile(join(root, "state.json"), "current-invalid");
    await writeFile(join(root, "state.previous.json"), "previous-invalid");

    const loaded = await new StateRepository(root).load();
    const files = await readdir(root);
    const currentQuarantine = files.find((file) =>
      file.startsWith("state.incompatible.current."),
    );
    const previousQuarantine = files.find((file) =>
      file.startsWith("state.incompatible.previous."),
    );

    expect(loaded.state.projects).toEqual([]);
    expect(await readFile(join(root, currentQuarantine!), "utf8")).toBe(
      "current-invalid",
    );
    expect(await readFile(join(root, previousQuarantine!), "utf8")).toBe(
      "previous-invalid",
    );
  });

  test.each([
    [
      "changes",
      (save: any) => {
        save.changes.addedFiles = [42];
      },
    ],
    [
      "checkpoint summaries",
      (save: any) => {
        delete save.summary.headline;
      },
    ],
    [
      "custom labels",
      (save: any) => {
        save.customLabel = "yes";
      },
    ],
  ])("rejects malformed %s and recovers the previous state", async (_name, mutate) => {
    const root = await mkdtemp(join(tmpdir(), "echoform-state-repo-"));
    roots.push(root);
    const repository = new StateRepository(root);
    await repository.save(stateWithAnalysis("valid previous"));
    await repository.save(stateWithAnalysis("valid current"));
    const invalid = stateWithAnalysis("invalid current");
    mutate(invalid.projects[0]!.saves[0]!);
    await writeFile(join(root, "state.json"), JSON.stringify(invalid));

    const loaded = await repository.load();

    expect(loaded.recoveredFromPrevious).toBe(true);
    expect(loaded.state.activity[0]?.message).toBe("valid previous");
  });

  test("rejects obsolete idea branch fields", async () => {
    const invalid = stateWithAnalysis("invalid");
    (invalid.projects[0]!.ideas[0]! as any).parentIdeaId = null;

    await expect(new StateRepository("unused").save(invalid)).rejects.toThrow(
      "invalid structure",
    );
  });

  test("rejects malformed project lineage and recovers the previous state", async () => {
    const root = await mkdtemp(join(tmpdir(), "echoform-state-repo-"));
    roots.push(root);
    const repository = new StateRepository(root);
    await repository.save(stateWithAnalysis("valid previous"));
    await repository.save(stateWithAnalysis("valid current"));
    const invalid = stateWithAnalysis("invalid current");
    (invalid.projects[0]! as any).continuedFrom = {
      projectId: "source-project",
    };
    await writeFile(join(root, "state.json"), JSON.stringify(invalid));

    const loaded = await repository.load();

    expect(loaded.recoveredFromPrevious).toBe(true);
    expect(loaded.state.activity[0]?.message).toBe("valid previous");
  });
});
