import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AbletonLauncher } from "./ableton-files";
import { EchoformService } from "./core";
import { writeAls } from "./test-support/als";
import type { AppState, Idea, Project, Save } from "./types";

function expectPresent<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
  return value as T;
}

function expectSave(result: { save: Save | null }): Save {
  return expectPresent(result.save);
}

describe("EchoformService history reliability", () => {
  let tmpRoot: string;
  let projectDir: string;
  let stateDir: string;
  let launcher: AbletonLauncher;
  let svc: EchoformService;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "echoform-core-"));
    projectDir = join(tmpRoot, "project");
    stateDir = join(tmpRoot, "state");
    await mkdir(projectDir, { recursive: true });
    await Bun.write(join(projectDir, "song.als"), "version-1");
    launcher = {
      openFile: mock(async () => {}),
      revealFile: mock(async () => {}),
    };
    svc = new EchoformService(stateDir, launcher, join(tmpRoot, "recoveries"));
  });

  afterEach(async () => {
    mock.restore();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("recovers a corrupt current state from the validated previous generation", async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    expect(tracked.continuedFrom).toBeNull();
    await svc.toggleWatching(tracked.id, false);
    await writeFile(join(stateDir, "state.json"), "{broken");

    const state = await svc.loadState();
    const quarantined = (await readdir(stateDir)).find((file) =>
      file.startsWith("state.incompatible.current."),
    );

    expect(state.projects[0]?.id).toBe(tracked.id);
    expect(state.activity[0]?.kind).toBe("state-recovered");
    expect(quarantined).toBeTruthy();
    expect(await readFile(join(stateDir, quarantined!), "utf8")).toBe(
      "{broken",
    );
  });

  test("quarantines incompatible state when no valid previous generation exists", async () => {
    await mkdir(stateDir, { recursive: true });
    const incompatible = JSON.stringify({ projects: [] });
    await writeFile(
      join(stateDir, "state.json"),
      incompatible,
    );

    const state = await svc.loadState();
    const quarantined = (await readdir(stateDir)).find((file) =>
      file.startsWith("state.incompatible.current."),
    );

    expect(state.projects).toEqual([]);
    expect(state.activity[0]?.message).toContain(
      "started with empty history metadata",
    );
    expect(quarantined).toBeTruthy();
    expect(await readFile(join(stateDir, quarantined!), "utf8")).toBe(
      incompatible,
    );
  });

  test("syncRoots discovers nested projects under watched roots and marks missing projects", async () => {
    const rootDir = join(tmpRoot, "roots");
    const nestedProjectDir = join(rootDir, "album", "nested-project");
    await mkdir(nestedProjectDir, { recursive: true });
    await Bun.write(join(nestedProjectDir, "nested.als"), "version-1");

    let snapshot = await svc.addRoot({ path: rootDir });
    const discovered = snapshot.projects.find(
      (project) => project.projectPath === nestedProjectDir,
    );

    expect(snapshot.roots).toHaveLength(1);
    expect(discovered).toBeTruthy();
    expect(discovered?.rootIds).toEqual([snapshot.roots[0]?.id]);
    expect(discovered?.presence).toBe("active");

    await rm(nestedProjectDir, { recursive: true, force: true });

    snapshot = await svc.syncRoots();
    const missing = snapshot.projects.find(
      (project) => project.projectPath === nestedProjectDir,
    );

    expect(missing?.presence).toBe("missing");
    expect(
      snapshot.activity.some((item) => item.kind === "project-missing"),
    ).toBe(true);
  });

  test("syncRoots marks a missing standalone project once without duplicating it", async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const movedPath = join(tmpRoot, "moved-standalone-project");
    await rename(projectDir, movedPath);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "replacement.als"), "new-project");

    const firstSync = await svc.syncRoots();
    const missingEvents = firstSync.activity.filter(
      (item) =>
        item.kind === "project-missing" && item.projectId === tracked.id,
    );

    expect(firstSync.projects).toHaveLength(1);
    expect(firstSync.projects[0]?.id).toBe(tracked.id);
    expect(firstSync.projects[0]?.rootIds).toEqual([]);
    expect(firstSync.projects[0]?.presence).toBe("missing");
    expect(missingEvents).toHaveLength(1);

    const secondSync = await svc.syncRoots();
    expect(secondSync.projects).toHaveLength(1);
    expect(
      secondSync.activity.filter(
        (item) =>
          item.kind === "project-missing" && item.projectId === tracked.id,
      ),
    ).toHaveLength(1);
  });

  test("root sync follows a moved project identity without duplicating history", async () => {
    const rootDir = join(tmpRoot, "move-root");
    const originalPath = join(rootDir, "original");
    const movedPath = join(rootDir, "moved");
    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, "song.als"), "move-v1");
    const snapshot = await svc.addRoot({ path: rootDir });
    const project = snapshot.projects.find(
      (candidate) => candidate.projectPath === originalPath,
    )!;
    const save = expectSave(
      await svc.createSave(project.id, { label: "Before move" }),
    );

    await rename(originalPath, movedPath);
    const synced = await svc.syncRoots();

    expect(synced.projects).toHaveLength(1);
    expect(synced.projects[0]?.id).toBe(project.id);
    expect(synced.projects[0]?.projectPath).toBe(movedPath);
    expect(synced.projects[0]?.saves[0]?.id).toBe(save.id);
    const recovery = await svc.recoverSave(project.id, save.id, false);
    expect(await readFile(recovery.activeSetPath, "utf8")).toBe("move-v1");
  });

  test("root sync replaces a stale copied identity without blocking discovery", async () => {
    const rootDir = join(tmpRoot, "stale-root");
    const copiedPath = join(rootDir, "copied");
    await mkdir(join(copiedPath, ".echoform-state"), { recursive: true });
    await writeFile(join(copiedPath, "song.als"), "copy-v1");
    await writeFile(
      join(copiedPath, ".echoform-state", "project.json"),
      JSON.stringify({ projectId: "stale-project" }),
    );

    const snapshot = await svc.addRoot({ path: rootDir });
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.projects[0]?.id).not.toBe("stale-project");
    expect(
      JSON.parse(
        await readFile(
          join(copiedPath, ".echoform-state", "project.json"),
          "utf8",
        ),
      ).projectId,
    ).toBe(snapshot.projects[0]?.id);
  });

  test("duplicate live identity markers keep the current path and re-identify the copy", async () => {
    const rootDir = join(tmpRoot, "duplicate-root");
    const originalPath = join(rootDir, "original");
    const copiedPath = join(rootDir, "copy");
    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, "song.als"), "original-v1");
    const initial = await svc.addRoot({ path: rootDir });
    const original = initial.projects[0]!;
    await cp(originalPath, copiedPath, { recursive: true });

    const synced = await svc.syncRoots();

    expect(synced.projects).toHaveLength(2);
    expect(
      synced.projects.find((project) => project.id === original.id)
        ?.projectPath,
    ).toBe(originalPath);
    const copy = synced.projects.find(
      (project) => project.projectPath === copiedPath,
    )!;
    expect(copy.id).not.toBe(original.id);
    expect(
      JSON.parse(
        await readFile(
          join(copiedPath, ".echoform-state", "project.json"),
          "utf8",
        ),
      ).projectId,
    ).toBe(copy.id);
  });

  test("watcher prefers the current idea when multiple .als files change together", async () => {
    await Bun.write(join(projectDir, "song-test.als"), "test-v1");

    const tracked = await svc.trackProject({ projectPath: projectDir });
    const songIdea = tracked.ideas.find((idea) => idea.setPath === "song.als")!;
    await svc.openIdea(tracked.id, songIdea.id);
    await svc.createSave(tracked.id, { label: "Original" });

    await writeFile(join(projectDir, "song.als"), "version-2");
    await writeFile(join(projectDir, "song-test.als"), "test-v2");

    const changed = await svc.handleWatchedAlsChange(tracked.id, [
      join(projectDir, "song.als"),
      join(projectDir, "song-test.als"),
    ]);

    expect(changed.save).not.toBeNull();
    expect(changed.project.currentIdeaId).toBe(songIdea.id);
    expect(changed.save?.metadata.activeSetPath).toBe("song.als");
    expect(changed.project.ideas).toHaveLength(2);
  });

  test("save creation keeps an idea bound to its own set file", async () => {
    await Bun.write(join(projectDir, "song-test.als"), "test-v1");

    const tracked = await svc.trackProject({ projectPath: projectDir });
    const songIdea = tracked.ideas.find((idea) => idea.setPath === "song.als")!;

    await Bun.sleep(5);
    await writeFile(join(projectDir, "song-test.als"), "test-v2");

    const state = await svc.loadState();
    const project = state.projects.find(
      (candidate) => candidate.id === tracked.id,
    )!;
    const idea = project.ideas.find(
      (candidate) => candidate.id === songIdea.id,
    )!;

    const result = await (
      svc as unknown as {
        createSaveInState: (
          state: AppState,
          project: Project,
          idea: Idea,
          input?: { label?: string; note?: string; auto?: boolean },
          preferredSetPath?: string,
        ) => Promise<{ project: Project; save: Save | null }>;
      }
    ).createSaveInState(state, project, idea, { auto: true }, "missing.als");

    const createdSave = expectSave(result);
    expect(idea.setPath).toBe("song.als");
    expect(createdSave.metadata.activeSetPath).toBe("song.als");
  });

  test("snapshot fails visibly when any source byte cannot be read", async () => {
    await Bun.write(join(projectDir, "sample.wav"), "audio-v1");

    const tracked = await svc.trackProject({ projectPath: projectDir });
    const first = await svc.createSave(tracked.id, { label: "Original" });
    expect(first.save).not.toBeNull();

    await chmod(join(projectDir, "sample.wav"), 0);
    await writeFile(join(projectDir, "song.als"), "version-2");

    await expect(
      svc.handleWatchedAlsChange(tracked.id, join(projectDir, "song.als")),
    ).rejects.toThrow();

    await chmod(join(projectDir, "sample.wav"), 0o644);

    const state = await svc.loadState();
    expect(state.projects[0]?.saves).toHaveLength(1);
  });

  test("autosave ignores unchanged .als content when only mtime changes", async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const first = await svc.createSave(tracked.id, { label: "Original" });
    expect(first.save).not.toBeNull();

    await Bun.sleep(5);
    await writeFile(join(projectDir, "song.als"), "version-1");

    const changed = await svc.handleWatchedAlsChange(
      tracked.id,
      join(projectDir, "song.als"),
    );

    expect(changed.save).toBeNull();

    const state = await svc.loadState();
    expect(state.projects[0]?.saves).toHaveLength(1);
  });

  test("tracking and saving ignore Ableton Backup directories", async () => {
    await mkdir(join(projectDir, "Backup"), { recursive: true });
    await Bun.write(join(projectDir, "Backup", "backup.als"), "backup-version");
    await Bun.write(join(projectDir, "Backup", "take.wav"), "backup-audio");
    await mkdir(join(projectDir, "Samples", "Backup"), { recursive: true });
    await Bun.write(
      join(projectDir, "Samples", "Backup", "legitimate.wav"),
      "legitimate-audio",
    );

    const tracked = await svc.trackProject({ projectPath: projectDir });
    expect(tracked.ideas).toHaveLength(1);
    expect(tracked.ideas[0]?.setPath).toBe("song.als");

    const created = await svc.createSave(tracked.id, { label: "Original" });
    const createdSave = expectSave(created);
    expect(createdSave.metadata.fileCount).toBe(2);
    expect(createdSave.metadata.sizeBytes).toBe(
      "version-1".length + "legitimate-audio".length,
    );

    const manifest = JSON.parse(
      await readFile(
        join(
          stateDir,
          "history",
          tracked.id,
          "manifests",
          `${createdSave.id}.json`,
        ),
        "utf8",
      ),
    ) as { files: Array<{ relativePath: string }> };

    expect(
      manifest.files.some((entry) => entry.relativePath.startsWith("Backup/")),
    ).toBe(false);
    expect(
      manifest.files.some(
        (entry) => entry.relativePath === "Samples/Backup/legitimate.wav",
      ),
    ).toBe(true);

    const recovery = await svc.recoverSave(tracked.id, createdSave.id, false);
    expect(
      await readFile(
        join(recovery.recoveredPath, "Samples", "Backup", "legitimate.wav"),
        "utf8",
      ),
    ).toBe("legitimate-audio");
  });

  test("compactStorage keeps protected/manual saves and removes redundant auto-saves", async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });

    const baseAuto = await svc.createSave(tracked.id, { auto: true });
    await writeFile(join(projectDir, "song.als"), "version-2");
    const dayAutoA = await svc.createSave(tracked.id, { auto: true });
    await writeFile(join(projectDir, "song.als"), "version-3");
    const dayAutoB = await svc.createSave(tracked.id, { auto: true });
    await writeFile(join(projectDir, "song.als"), "version-4");
    const weekAutoA = await svc.createSave(tracked.id, { auto: true });
    await writeFile(join(projectDir, "song.als"), "version-5");
    const weekAutoB = await svc.createSave(tracked.id, { auto: true });
    await writeFile(join(projectDir, "song.als"), "version-6");
    const recentAuto = await svc.createSave(tracked.id, { auto: true });
    await writeFile(join(projectDir, "song.als"), "manual-version");
    const manual = await svc.createSave(tracked.id, { label: "Manual keep" });
    const baseAutoSave = expectSave(baseAuto);
    const dayAutoASave = expectSave(dayAutoA);
    const dayAutoBSave = expectSave(dayAutoB);
    const weekAutoASave = expectSave(weekAutoA);
    const weekAutoBSave = expectSave(weekAutoB);
    const recentAutoSave = expectSave(recentAuto);
    const manualSave = expectSave(manual);

    const state = await svc.loadState();
    const project = state.projects[0]!;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const isoDaysAgo = (days: number, hour = 0, minute = 0) => {
      const date = new Date(now - days * dayMs);
      date.setUTCHours(hour, minute, 0, 0);
      return date.toISOString();
    };
    // Compute two timestamps guaranteed to be in the same ISO week (Mon–Sun),
    // both > 30 days old, to avoid the test breaking when the fixed offsets
    // 44/45 straddle a Monday boundary.
    const anchorDate = new Date(now - 40 * dayMs);
    anchorDate.setUTCHours(0, 0, 0, 0);
    const mondayOfWeek = new Date(anchorDate);
    mondayOfWeek.setUTCDate(
      anchorDate.getUTCDate() - ((anchorDate.getUTCDay() + 6) % 7),
    );
    mondayOfWeek.setUTCHours(8, 10, 0, 0);
    const tuesdayOfWeek = new Date(mondayOfWeek);
    tuesdayOfWeek.setUTCDate(mondayOfWeek.getUTCDate() + 1);
    tuesdayOfWeek.setUTCHours(9, 20, 0, 0);
    const createdAtById = new Map<string, string>([
      [baseAutoSave.id, isoDaysAgo(90, 0, 0)],
      [dayAutoASave.id, isoDaysAgo(10, 8, 10)],
      [dayAutoBSave.id, isoDaysAgo(10, 9, 20)],
      [weekAutoASave.id, mondayOfWeek.toISOString()],
      [weekAutoBSave.id, tuesdayOfWeek.toISOString()],
      [recentAutoSave.id, isoDaysAgo(1, 12, 0)],
      [manualSave.id, new Date(now).toISOString()],
    ]);

    for (const save of project.saves) {
      const createdAt = createdAtById.get(save.id);
      if (createdAt) {
        save.createdAt = createdAt;
      }
    }
    project.updatedAt = new Date(now).toISOString();
    await Bun.write(
      join(stateDir, "state.json"),
      JSON.stringify(state, null, 2),
    );

    const usageBefore = await svc.getDiskUsage(tracked.id);
    expect(usageBefore.eligibleAutoSaveCount).toBe(2);

    const compacted = await svc.compactStorage(tracked.id);
    expect(compacted.deletedCount).toBe(2);

    const compactedState = await svc.loadState();
    const remainingIds = new Set(
      compactedState.projects[0]?.saves.map((save) => save.id),
    );

    expect(remainingIds.has(baseAutoSave.id)).toBe(true);
    expect(remainingIds.has(dayAutoBSave.id)).toBe(true);
    expect(remainingIds.has(weekAutoBSave.id)).toBe(true);
    expect(remainingIds.has(recentAutoSave.id)).toBe(true);
    expect(remainingIds.has(manualSave.id)).toBe(true);
    expect(remainingIds.has(dayAutoASave.id)).toBe(false);
    expect(remainingIds.has(weekAutoASave.id)).toBe(false);

    const usageAfter = await svc.getDiskUsage(tracked.id);
    expect(usageAfter.eligibleAutoSaveCount).toBe(0);
    expect(usageAfter.manualSaveCount).toBe(1);
    expect(usageAfter.autoSaveCount).toBe(4);
    expect(usageAfter.oldestAutoSaveAt).toBe(
      expectPresent(createdAtById.get(baseAutoSave.id)),
    );
    expect(usageAfter.largestAutoSaveBytes).toBeGreaterThan(0);
  });

  test("requestPreview creates deterministic pending preview state", async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const created = await svc.createSave(tracked.id, { label: "Original" });
    const save = expectSave(created);

    const preview = await svc.requestPreview(tracked.id, save.id);
    const state = await svc.loadState();
    const updatedSave = state.projects[0]?.saves[0]!;

    expect(preview.saveId).toBe(save.id);
    expect(preview.expectedBaseName).toBe("preview");
    expect(preview.acceptedExtensions).toEqual([
      ".wav",
      ".aif",
      ".aiff",
      ".mp3",
      ".m4a",
    ]);
    expect(preview.folderPath.endsWith(join("project", save.id))).toBe(true);
    expect(updatedSave.previewStatus).toBe("pending");
    expect(updatedSave.previewRequestedAt).toBeTruthy();
    await access(preview.folderPath);
  });

  test("ingestPendingPreviews ignores non-audio files and stays pending", async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const created = await svc.createSave(tracked.id, { label: "Original" });
    const createdSave = expectSave(created);
    const preview = await svc.requestPreview(tracked.id, createdSave.id);

    await writeFile(join(preview.folderPath, "preview.txt"), "not-a-preview");
    const changed = await svc.ingestPendingPreviews();
    const state = await svc.loadState();
    const updatedSave = state.projects[0]?.saves[0]!;

    expect(changed).toBe(false);
    expect(updatedSave.previewStatus).toBe("pending");
  });

  test("ingestPendingPreviews accepts any audio filename", async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const created = await svc.createSave(tracked.id, { label: "Original" });
    const createdSave = expectSave(created);
    const preview = await svc.requestPreview(tracked.id, createdSave.id);

    await writeFile(join(preview.folderPath, "my-bounce.wav"), "audio-data");
    expect(await svc.ingestPendingPreviews()).toBe(true);

    const state = await svc.loadState();
    const updatedSave = state.projects[0]?.saves[0]!;
    expect(updatedSave.previewStatus).toBe("ready");
    expect(updatedSave.previewMime).toBe("audio/wav");
  });

  test("ingestPendingPreviews copies previews, replaces older ones, and missing files downgrade status", async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const created = await svc.createSave(tracked.id, { label: "Original" });
    const save = expectSave(created);

    const firstRequest = await svc.requestPreview(tracked.id, save.id);
    await writeFile(join(firstRequest.folderPath, "preview.wav"), "preview-v1");

    expect(await svc.ingestPendingPreviews()).toBe(true);

    let state = await svc.loadState();
    let updatedSave = state.projects[0]?.saves[0]!;
    const firstManagedPath = updatedSave.previewRefs[0]!;

    expect(updatedSave.previewStatus).toBe("ready");
    expect(updatedSave.previewMime).toBe("audio/wav");
    expect(await readFile(firstManagedPath, "utf8")).toBe("preview-v1");
    expect(await svc.resolvePreviewPath(firstManagedPath)).toBe(
      firstManagedPath,
    );

    const secondRequest = await svc.requestPreview(tracked.id, save.id);
    await expect(access(firstManagedPath)).rejects.toThrow();
    await writeFile(
      join(secondRequest.folderPath, "preview.mp3"),
      "preview-v2",
    );

    expect(await svc.ingestPendingPreviews()).toBe(true);

    state = await svc.loadState();
    updatedSave = state.projects[0]?.saves[0]!;
    const secondManagedPath = updatedSave.previewRefs[0]!;

    expect(secondManagedPath).not.toBe(firstManagedPath);
    expect(updatedSave.previewMime).toBe("audio/mpeg");
    expect(await readFile(secondManagedPath, "utf8")).toBe("preview-v2");

    await rm(secondManagedPath, { force: true });
    await expect(svc.resolvePreviewPath(secondManagedPath)).rejects.toThrow(
      "File not found",
    );

    state = await svc.loadState();
    updatedSave = state.projects[0]?.saves[0]!;
    expect(updatedSave.previewStatus).toBe("missing");
    expect(updatedSave.previewRefs).toEqual([]);
  });

  test("tracking a project with multiple .als files creates one idea per file", async () => {
    await Bun.write(join(projectDir, "vocals.als"), "v-data");
    await Bun.write(join(projectDir, "drums.als"), "d-data");

    const tracked = await svc.trackProject({ projectPath: projectDir });

    // 3 .als files → 3 ideas (song.als, vocals.als, drums.als)
    expect(tracked.ideas).toHaveLength(3);
    const ideaNames = tracked.ideas.map((i) => i.name).sort();
    expect(ideaNames).toEqual(["drums", "song", "vocals"]);
    // Each idea has a unique setPath pointing to its .als
    const setPaths = tracked.ideas.map((i) => i.setPath).sort();
    expect(setPaths).toEqual(["drums.als", "song.als", "vocals.als"]);
    // currentIdeaId points to one of the ideas
    expect(tracked.ideas.some((i) => i.id === tracked.currentIdeaId)).toBe(
      true,
    );
  });

  test("watcher auto-creates an idea when an unknown .als file is changed", async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    expect(tracked.ideas).toHaveLength(1);
    expect(tracked.ideas[0]?.name).toBe("song");

    // A new .als appears in the project folder after tracking
    const newAlsPath = join(projectDir, "remix.als");
    await Bun.write(newAlsPath, "remix-data");

    const result = await svc.handleWatchedAlsChange(tracked.id, newAlsPath);

    // Should auto-create a new idea instead of setting drift status
    expect(result.stateChanged).toBe(true);
    expect(result.project.driftStatus).toBeNull();
    expect(result.project.ideas).toHaveLength(2);
    const newIdea = result.project.ideas.find((i) => i.name === "remix");
    const ensuredNewIdea = expectPresent(newIdea);
    expect(ensuredNewIdea.setPath).toBe("remix.als");
    expect(result.project.currentIdeaId).toBe(ensuredNewIdea.id);
  });

  test("pruning retains curated auto-saves and explicit pins", async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const makeAuto = async (
      content: string,
      input: { label?: string; note?: string } = {},
    ) => {
      await writeFile(join(projectDir, "song.als"), content);
      return expectSave(
        await svc.createSave(tracked.id, { auto: true, ...input }),
      );
    };
    const base = await makeAuto("base");
    const custom = await makeAuto("custom", { label: "My milestone" });
    const noted = await makeAuto("noted", { note: "Keep this reasoning" });
    const pinned = await makeAuto("pinned");
    await svc.updateSave(tracked.id, pinned.id, { pinned: true });
    const previewed = await makeAuto("previewed");
    await svc.requestPreview(tracked.id, previewed.id);
    const disposable = await makeAuto("disposable");
    const head = await makeAuto("head");

    await Bun.sleep(2);
    await svc.pruneSaves(tracked.id, 0);
    const remaining = new Set(
      (await svc.loadState()).projects[0]!.saves.map((save) => save.id),
    );

    for (const kept of [base, custom, noted, pinned, previewed, head]) {
      expect(remaining.has(kept.id)).toBe(true);
    }
    expect(remaining.has(disposable.id)).toBe(false);
  });

  test("recovers and verifies every file in a full project save", async () => {
    await mkdir(join(projectDir, "Samples", "empty"), { recursive: true });
    await writeFile(join(projectDir, "Samples", "kick.wav"), "kick-v1");
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const saved = expectSave(
      await svc.createSave(tracked.id, { label: "Full" }),
    );
    await rm(projectDir, { recursive: true, force: true });

    const recovery = await svc.recoverSave(tracked.id, saved.id, false);

    expect(recovery.sourceProjectId).toBe(tracked.id);
    expect(recovery.recoveredProjectId).not.toBe(tracked.id);
    expect(recovery.openError).toBeNull();
    const recoveredProject = (await svc.loadState()).projects.find(
      (project) => project.id === recovery.recoveredProjectId,
    )!;
    expect(recoveredProject.name).toBe(`Branch of ${tracked.name}`);
    expect(recoveredProject.continuedFrom).toEqual({
      projectId: tracked.id,
      saveId: saved.id,
    });
    expect(recoveredProject.watching).toBe(true);
    expect(recoveredProject.saves).toHaveLength(1);
    expect(recoveredProject.saves[0]?.label).toBe(
      `Continued from ${saved.label}`,
    );
    expect(recoveredProject.saves[0]?.pinned).toBe(true);
    expect(recovery.recoveredPath).not.toBe(projectDir);
    expect(
      await readFile(join(recovery.recoveredPath, "song.als"), "utf8"),
    ).toBe("version-1");
    expect(
      await readFile(
        join(recovery.recoveredPath, "Samples", "kick.wav"),
        "utf8",
      ),
    ).toBe("kick-v1");
    await access(join(recovery.recoveredPath, "Samples", "empty"));

    const reloadedService = new EchoformService(
      stateDir,
      launcher,
      join(tmpRoot, "recoveries"),
    );
    const reloadedBranch = (await reloadedService.loadState()).projects.find(
      (project) => project.id === recovery.recoveredProjectId,
    );
    expect(reloadedBranch?.continuedFrom).toEqual({
      projectId: tracked.id,
      saveId: saved.id,
    });

    const manifest = JSON.parse(
      await readFile(
        join(stateDir, "history", tracked.id, "manifests", `${saved.id}.json`),
        "utf8",
      ),
    ) as { files: Array<{ type?: "dir"; blobHash?: string }> };
    const blobHash = manifest.files.find(
      (entry) => entry.type !== "dir",
    )?.blobHash;
    expect(blobHash).toBeTruthy();
    await writeFile(
      join(stateDir, "history", tracked.id, "blobs", blobHash!),
      "tampered",
    );
    await expect(svc.recoverSave(tracked.id, saved.id, false)).rejects.toThrow(
      "Blob verification failed",
    );
  });

  test("keeps a recovered project tracked when Ableton fails to open", async () => {
    launcher.openFile = mock(async () => {
      throw new Error("Ableton unavailable");
    });
    svc = new EchoformService(stateDir, launcher, join(tmpRoot, "recoveries"));
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const saved = expectSave(
      await svc.createSave(tracked.id, { label: "Open failure source" }),
    );

    const recovery = await svc.recoverSave(tracked.id, saved.id, true);
    const state = await svc.loadState();
    const recovered = state.projects.find(
      (project) => project.id === recovery.recoveredProjectId,
    );

    expect(recovery.openError).toBe("Ableton unavailable");
    expect(recovered?.watching).toBe(true);
    expect(recovered?.saves[0]?.pinned).toBe(true);
  });

  test("serializes recovery against destructive save deletion", async () => {
    let signalOpenStarted!: () => void;
    const openStarted = new Promise<void>((resolve) => {
      signalOpenStarted = resolve;
    });
    let releaseOpen!: () => void;
    const openReleased = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    launcher.openFile = mock(async () => {
      signalOpenStarted();
      await openReleased;
    });
    svc = new EchoformService(stateDir, launcher, join(tmpRoot, "recoveries"));
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const saved = expectSave(
      await svc.createSave(tracked.id, { label: "Race source" }),
    );

    const recovering = svc.recoverSave(tracked.id, saved.id, true);
    await openStarted;
    let deletionFinished = false;
    const deleting = svc.deleteSave(tracked.id, saved.id).then(() => {
      deletionFinished = true;
    });
    await Bun.sleep(10);
    expect(deletionFinished).toBe(false);

    releaseOpen();
    const recovery = await recovering;
    await deleting;
    expect(recovery.openError).toBeNull();
    expect(
      (await svc.loadState()).projects.some(
        (project) => project.id === recovery.recoveredProjectId,
      ),
    ).toBe(true);
  });

  test("relink refuses to overwrite another tracked project identity", async () => {
    const otherPath = join(tmpRoot, "other-project");
    await mkdir(otherPath, { recursive: true });
    await writeFile(join(otherPath, "other.als"), "other-v1");
    const first = await svc.trackProject({ projectPath: projectDir });
    const other = await svc.trackProject({ projectPath: otherPath });

    await expect(svc.relinkProject(first.id, otherPath)).rejects.toThrow(
      "already tracked",
    );
    expect(
      JSON.parse(
        await readFile(
          join(otherPath, ".echoform-state", "project.json"),
          "utf8",
        ),
      ).projectId,
    ).toBe(other.id);
  });

  test("relink rolls back a new identity marker when state persistence fails", async () => {
    const targetPath = join(tmpRoot, "relink-target");
    await mkdir(targetPath, { recursive: true });
    await writeFile(join(targetPath, "target.als"), "target-v1");
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const originalSaveState = (svc as any).saveState.bind(svc);
    (svc as any).saveState = async () => {
      throw new Error("injected relink state failure");
    };

    await expect(svc.relinkProject(tracked.id, targetPath)).rejects.toThrow(
      "injected relink state failure",
    );
    await expect(
      access(join(targetPath, ".echoform-state", "project.json")),
    ).rejects.toThrow();

    (svc as any).saveState = originalSaveState;
    expect((await svc.loadState()).projects[0]?.projectPath).toBe(projectDir);
  });

  test("delete remains successful when previous-generation rotation fails, then reconciles", async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const saved = expectSave(
      await svc.createSave(tracked.id, { label: "Delete me" }),
    );
    const manifestPath = join(
      stateDir,
      "history",
      tracked.id,
      "manifests",
      `${saved.id}.json`,
    );
    const originalSaveState = (svc as any).saveState.bind(svc);
    let saveCalls = 0;
    (svc as any).saveState = async (state: AppState) => {
      saveCalls++;
      if (saveCalls >= 2) {
        throw new Error("injected second-generation failure");
      }
      return originalSaveState(state);
    };

    const deleted = await svc.deleteSave(tracked.id, saved.id);
    expect(deleted.saves).toHaveLength(0);
    await access(manifestPath);

    svc = new EchoformService(stateDir, launcher, join(tmpRoot, "recoveries"));
    await svc.reconcileStorage();
    await expect(access(manifestPath)).rejects.toThrow();
  });

  test("analysis reads from history after the working folder is lost", async () => {
    const songPath = join(projectDir, "song.als");
    const track = { id: "1", name: "Lead", type: "midi" as const };
    await writeAls(songPath, { tracks: [{ ...track, clips: [] }] });
    const tracked = await svc.trackProject({ projectPath: projectDir });
    await svc.createSave(tracked.id, { label: "Base" });
    await writeAls(songPath, {
      tracks: [{ ...track, clips: [{ end: 8, notes: [{ key: 60, time: 0 }], start: 4 }] }],
    });
    const latest = expectSave(await svc.createSave(tracked.id, { auto: true }));
    await rm(projectDir, { force: true, recursive: true });

    const { analysis } = await svc.getSaveAnalysis(tracked.id, latest.id);

    expect(analysis.summary.headline).toBe("Lead: new part in bar 2");
    const [project] = await svc.listProjects();
    expect(project?.saves.find((s) => s.id === latest.id)?.summary?.headline).toBe(
      "Lead: new part in bar 2",
    );
  });

  test("summaries are backfilled and recomputed when the previous checkpoint is deleted", async () => {
    const songPath = join(projectDir, "song.als");
    const lead = (clips: number) => ({
      tracks: [
        {
          clips: Array.from({ length: clips }, (_, i) => ({
            end: i * 4 + 4,
            notes: [{ key: 60, time: 0 }],
            start: i * 4,
          })),
          id: "1",
          name: "Lead",
          type: "midi" as const,
        },
      ],
    });
    await writeAls(songPath, lead(1));
    const tracked = await svc.trackProject({ projectPath: projectDir });
    await svc.createSave(tracked.id, { label: "One" });
    await writeAls(songPath, lead(2));
    const middle = expectSave(await svc.createSave(tracked.id, { auto: true }));
    await writeAls(songPath, lead(3));
    const last = expectSave(await svc.createSave(tracked.id, { auto: true }));

    while ((await svc.summarizeNextSave()) !== undefined) {
      // drain
    }
    let [project] = await svc.listProjects();
    expect(project?.saves.find((s) => s.id === last.id)?.summary?.headline).toBe(
      "Lead: new part in bar 3",
    );

    await svc.deleteSave(tracked.id, middle.id);
    while ((await svc.summarizeNextSave()) !== undefined) {
      // drain
    }
    [project] = await svc.listProjects();
    expect(project?.saves.find((s) => s.id === last.id)?.summary?.headline).toBe(
      "Lead: new part in bars 2–3",
    );
  });

  test("deleting a tracked project only removes it from Echoform state", async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    await svc.createSave(tracked.id, { label: "Original" });

    const remaining = await svc.deleteProject(tracked.id);

    expect(remaining).toHaveLength(0);
    await access(projectDir);
    await access(join(projectDir, "song.als"));
  });
});
