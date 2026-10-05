import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { mapWithConcurrency } from "./async-utils";
import type { ManifestEntry } from "./blob-store";
import {
  gcBlobs,
  getBlobPath,
  readManifest,
  resolveProjectStateDir,
  stageManifestsForDeletion,
} from "./blob-store";
import type { AbletonLauncher } from "./ableton-files";
import {
  buildAbsolutePathIndex,
  changePathToRelativeSetPath,
  createAbletonLauncher,
  normalizeAbsolutePath,
  resolveProjectFilePath,
} from "./ableton-files";
import { discoverProjectsInRoot, discoverRootSuggestions } from "./discovery";
import { STATE_DIRNAME } from "./paths";
import { captureStoredSnapshot, recoverStoredSnapshot } from "./history-store";
import { type LiveSet, readLiveSet } from "./live-set";
import { analyzeSets } from "./set-compare";
import { StateRepository } from "./state-repository";
import type {
  ActivityItem,
  AppState,
  ChangeSummary,
  CompareResult,
  DiskUsage,
  DriftStatus,
  Idea,
  PendingOpen,
  PreviewRequestResult,
  PreviewStatus,
  Project,
  ProjectMetadata,
  RootSuggestion,
  RecoveryResult,
  Save,
  SaveAnalysis,
  SaveSummary,
  TrackedRoot,
} from "./types";
import { ANALYSIS_VERSION } from "./types";

const AUDIO_EXTENSIONS = new Set([
  ".aif",
  ".aiff",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".wav",
]);

interface FileRecord {
  contentHash?: string;
  mtimeMs: number;
  relativePath: string;
  size: number;
}
interface ProjectSnapshot {
  emptyDirs: string[];
  files: FileRecord[];
}
const MAX_ACTIVITY_ITEMS = 80;
const WALK_CONCURRENCY = 32;
const AUTO_COMPACT_MAX_AUTO_SAVES = 100;
const LIVE_SET_CACHE_SIZE = 4;
const AUTO_COMPACT_MAX_BLOB_STORAGE_BYTES = 2 * 1024 * 1024 * 1024;
const PREVIEW_FILE_BASENAME = "preview";
const PREVIEW_EXTENSIONS = [".wav", ".aif", ".aiff", ".mp3", ".m4a"] as const;
const PREVIEW_EXTENSION_SET = new Set<string>(PREVIEW_EXTENSIONS);
const PREVIEW_MIME_BY_EXTENSION: Record<string, string> = {
  ".wav": "audio/wav",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
};

function isAlsPath(path: string): boolean {
  return extname(path).toLowerCase() === ".als";
}

function isBackupRelativePath(path: string): boolean {
  return path.startsWith("Backup/") || path.startsWith("Backup\\");
}

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createActivity(
  kind: ActivityItem["kind"],
  message: string,
  severity: ActivityItem["severity"],
  extra: Pick<ActivityItem, "rootId" | "projectId"> = {},
): ActivityItem {
  return {
    id: createId("activity"),
    kind,
    message,
    severity,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

function pushActivity(state: AppState, activity: ActivityItem): void {
  state.activity = [activity, ...state.activity].slice(0, MAX_ACTIVITY_ITEMS);
}

function requireProject(state: AppState, id: string): Project {
  const p = state.projects.find((x) => x.id === id);
  if (!p) {
    throw new AppError("Project not found.", 404);
  }
  return p;
}

function requireIdea(project: Project, id: string): Idea {
  const i = project.ideas.find((x) => x.id === id);
  if (!i) {
    throw new AppError("Idea not found.", 404);
  }
  return i;
}

function requireSave(project: Project, id: string): Save {
  const s = project.saves.find((x) => x.id === id);
  if (!s) {
    throw new AppError("Save not found.", 404);
  }
  return s;
}

function isIdeaNameTaken(project: Project, name: string): boolean {
  return project.ideas.some((i) => i.name.toLowerCase() === name.toLowerCase());
}

function ensureUniqueIdeaName(project: Project, baseName: string): string {
  const trimmed = baseName.trim() || "Recovered version";
  if (!isIdeaNameTaken(project, trimmed)) {
    return trimmed;
  }
  let n = 2;
  while (isIdeaNameTaken(project, `${trimmed} ${n}`)) {
    n++;
  }
  return `${trimmed} ${n}`;
}

// ── Filesystem helpers ──────────────────────────────────────────────

async function walkProject(
  rootPath: string,
  currentPath = rootPath,
): Promise<ProjectSnapshot> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files: FileRecord[] = [];
  const emptyDirs: string[] = [];
  const snapshots = await mapWithConcurrency(
    entries,
    WALK_CONCURRENCY,
    async (entry): Promise<ProjectSnapshot> => {
      const abs = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === STATE_DIRNAME ||
          (currentPath === rootPath && entry.name === "Backup")
        ) {
          return { files: [], emptyDirs: [] };
        }
        const child = await walkProject(rootPath, abs);
        if (child.files.length === 0 && child.emptyDirs.length === 0) {
          return {
            files: [],
            emptyDirs: [relative(rootPath, abs)],
          };
        }
        return child;
      }

      const s = await stat(abs);
      return {
        files: [
          {
            relativePath: relative(rootPath, abs),
            size: s.size,
            mtimeMs: s.mtimeMs,
          },
        ],
        emptyDirs: [],
      };
    },
  );

  for (const snapshot of snapshots) {
    files.push(...snapshot.files);
    emptyDirs.push(...snapshot.emptyDirs);
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  emptyDirs.sort((a, b) => a.localeCompare(b));
  return { files, emptyDirs };
}

function metadataFromFiles(
  files: FileRecord[],
  preferred?: string,
): ProjectMetadata {
  const setFiles = files
    .filter(
      (f) => isAlsPath(f.relativePath) && !isBackupRelativePath(f.relativePath),
    )
    .map((f) => f.relativePath)
    .sort();
  if (setFiles.length === 0) {
    throw new AppError("No Ableton .als file found in the project folder.");
  }
  const activeSetPath =
    preferred && setFiles.includes(preferred)
      ? preferred
      : detectActiveSet(files, setFiles);
  const audioFiles = files.filter((f) =>
    AUDIO_EXTENSIONS.has(extname(f.relativePath).toLowerCase()),
  ).length;
  const sizeBytes = files.reduce((s, f) => s + f.size, 0);
  const latest = files.reduce((m, f) => Math.max(m, f.mtimeMs), 0);
  return {
    activeSetPath,
    setFiles,
    audioFiles,
    fileCount: files.length,
    sizeBytes,
    modifiedAt: new Date(latest || Date.now()).toISOString(),
  };
}

function detectActiveSet(files: FileRecord[], setFiles: string[]): string {
  const sorted = files
    .filter((f) => setFiles.includes(f.relativePath))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sorted[0]?.relativePath ?? setFiles[0]!;
}

function manifestFileEntries(entries: ManifestEntry[]): Array<
  ManifestEntry & {
    blobHash: string;
    size: number;
    mtimeMs?: number;
    contentHash?: string;
  }
> {
  return entries.filter(
    (
      entry,
    ): entry is ManifestEntry & {
      blobHash: string;
      size: number;
      mtimeMs?: number;
      contentHash?: string;
    } => entry.type !== "dir",
  );
}

/** Build a file-diff summary from two manifest entry lists. */
function diffManifestEntries(
  prev: ManifestEntry[],
  curr: ManifestEntry[],
): Omit<ChangeSummary, "sizeDelta"> {
  const prevMap = new Map(
    manifestFileEntries(prev).map((f) => [f.relativePath, f]),
  );
  const currMap = new Map(
    manifestFileEntries(curr).map((f) => [f.relativePath, f]),
  );
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const skip = (p: string) => isAlsPath(p) || isBackupRelativePath(p);
  for (const [path, file] of currMap) {
    if (skip(path)) {
      continue;
    }
    const old = prevMap.get(path);
    if (!old) {
      addedFiles.push(path);
    } else if (old.blobHash !== file.blobHash) {
      modifiedFiles.push(path);
    }
  }
  for (const path of prevMap.keys()) {
    if (skip(path)) {
      continue;
    }
    if (!currMap.has(path)) {
      removedFiles.push(path);
    }
  }
  return { addedFiles, removedFiles, modifiedFiles };
}

function autoLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isSameSummary(a: SaveSummary | undefined, b: SaveSummary): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function slugifyProjectName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

function inferPreviewMime(previewPath: string): string | null {
  return PREVIEW_MIME_BY_EXTENSION[extname(previewPath).toLowerCase()] ?? null;
}

function derivePreviewStatus(
  save: Pick<Save, "previewRefs" | "previewStatus">,
): PreviewStatus {
  if (
    save.previewStatus === "pending" ||
    save.previewStatus === "error" ||
    save.previewStatus === "missing"
  ) {
    return save.previewStatus;
  }
  return save.previewRefs.length > 0 ? "ready" : "none";
}

function resolveIdeaSetPath(
  metadata: ProjectMetadata,
  currentSetPath: string,
  preferredSetPath?: string,
): string {
  if (preferredSetPath && metadata.setFiles.includes(preferredSetPath)) {
    return preferredSetPath;
  }
  if (metadata.setFiles.includes(currentSetPath)) {
    return currentSetPath;
  }
  return metadata.activeSetPath;
}

async function getBlobStorageStats(historyDir: string): Promise<{
  blobStorageBytes: number;
  blobCount: number;
}> {
  const blobsDirPath = join(historyDir, "blobs");
  let blobStorageBytes = 0;
  let blobCount = 0;
  try {
    const entries = await readdir(blobsDirPath);
    for (const name of entries) {
      if (name.endsWith(".tmp")) {
        continue;
      }
      const s = await stat(join(blobsDirPath, name));
      blobStorageBytes += s.size;
      blobCount++;
    }
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      throw error;
    }
  }
  return { blobStorageBytes, blobCount };
}

function compactRetentionBucketKey(
  createdAt: string,
  now: Date,
): string | null {
  const created = new Date(createdAt);
  const ageMs = now.getTime() - created.getTime();
  if (ageMs < 0) {
    return `future:${createdAt}`;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  if (ageMs <= dayMs) {
    return null;
  }
  if (ageMs <= 7 * dayMs) {
    const hour = created.toISOString().slice(0, 13);
    return `hour:${hour}`;
  }
  if (ageMs <= 30 * dayMs) {
    const day = created.toISOString().slice(0, 10);
    return `day:${day}`;
  }

  const weekStart = new Date(created);
  weekStart.setUTCHours(0, 0, 0, 0);
  const day = weekStart.getUTCDay();
  const delta = (day + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - delta);
  return `week:${weekStart.toISOString().slice(0, 10)}`;
}

function getProtectedSaveIds(project: Project): Set<string> {
  return new Set([
    ...project.ideas.map((idea) => idea.headSaveId),
    ...project.ideas.map((idea) => idea.baseSaveId),
    ...project.saves
      .filter(
        (save) =>
          save.pinned ||
          Boolean(save.customLabel) ||
          save.note.trim().length > 0 ||
          save.previewRefs.length > 0 ||
          save.previewStatus === "pending",
      )
      .map((save) => save.id),
  ]);
}

function computeAutoSavesToCompact(project: Project, now = new Date()): Save[] {
  const protectedIds = getProtectedSaveIds(project);
  const autoSaves = project.saves
    .filter((save) => save.auto)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const kept = new Set<string>();
  const bucketKeepers = new Map<string, string>();

  for (const save of autoSaves) {
    if (protectedIds.has(save.id)) {
      kept.add(save.id);
      continue;
    }

    const bucket = compactRetentionBucketKey(save.createdAt, now);
    if (bucket === null) {
      kept.add(save.id);
      continue;
    }

    if (!bucketKeepers.has(bucket)) {
      bucketKeepers.set(bucket, save.id);
      kept.add(save.id);
    }
  }

  return autoSaves.filter((save) => !kept.has(save.id));
}

/** Find the blob hash for the active .als file in a manifest's entries. */
function findAlsHashInEntries(
  entries: ManifestEntry[],
  activeSetPath: string,
): string | null {
  return (
    manifestFileEntries(entries).find((e) => e.relativePath === activeSetPath)
      ?.blobHash ?? null
  );
}

async function findAlsHashForSave(
  historyDir: string,
  saveId: string,
  activeSetPath: string,
): Promise<string | null> {
  try {
    const manifest = await readManifest(historyDir, saveId);
    return findAlsHashInEntries(manifest.files, activeSetPath);
  } catch {
    return null;
  }
}

async function computeManifestChangeSummary(
  historyDir: string,
  prevSave: Save,
  currSaveId: string,
  currMetadata: ProjectMetadata,
): Promise<ChangeSummary | undefined> {
  try {
    const [prevManifest, currManifest] = await Promise.all([
      readManifest(historyDir, prevSave.id),
      readManifest(historyDir, currSaveId),
    ]);
    const diff = diffManifestEntries(prevManifest.files, currManifest.files);
    return {
      ...diff,
      sizeDelta: currMetadata.sizeBytes - prevSave.metadata.sizeBytes,
    };
  } catch {
    return undefined;
  }
}

// ── Async Mutex ─────────────────────────────────────────────────────

const MUTEX_TIMEOUT_MS = 30_000;

class AsyncMutex {
  private readonly queue: (() => void)[] = [];
  private locked = false;

  async acquire(timeoutMs = MUTEX_TIMEOUT_MS): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.indexOf(onRelease);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        reject(new AppError("State lock timeout — try again.", 503));
      }, timeoutMs);
      const onRelease = () => {
        clearTimeout(timer);
        resolve();
      };
      this.queue.push(onRelease);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

// ── Service ─────────────────────────────────────────────────────────

export class EchoformService {
  private readonly rootDir: string;
  private readonly stateRepository: StateRepository;
  private readonly mutex = new AsyncMutex();
  private readonly launcher: AbletonLauncher;
  private readonly recoveryRoot: string;
  private readonly liveSetCache = new Map<string, Promise<LiveSet>>();
  private readonly unreadableSaves = new Set<string>();
  private readonly ideaPathIndex = new Map<string, Map<string, string>>();
  private readonly previewPathIndex = new Map<
    string,
    { projectId: string; saveId: string }
  >();

  constructor(
    rootDir = resolve(process.cwd(), STATE_DIRNAME),
    launcher: AbletonLauncher = createAbletonLauncher(),
    recoveryRoot = join(homedir(), "Music", "Echoform Recoveries"),
  ) {
    this.rootDir = rootDir;
    this.stateRepository = new StateRepository(rootDir);
    this.launcher = launcher;
    this.recoveryRoot = recoveryRoot;
  }

  private refreshProjectPathIndex(project: Project): void {
    this.ideaPathIndex.set(
      project.id,
      buildAbsolutePathIndex(
        project.projectPath,
        project.ideas.map((idea) => ({
          ideaId: idea.id,
          setPath: idea.setPath,
        })),
      ),
    );
  }

  private refreshPreviewPathIndex(state: AppState): void {
    this.previewPathIndex.clear();
    for (const project of state.projects) {
      for (const save of project.saves) {
        for (const previewRef of save.previewRefs) {
          this.previewPathIndex.set(resolve(previewRef), {
            projectId: project.id,
            saveId: save.id,
          });
        }
      }
    }
  }

  private refreshPathIndexes(state: AppState): void {
    this.ideaPathIndex.clear();
    for (const project of state.projects) {
      this.refreshProjectPathIndex(project);
    }
    this.refreshPreviewPathIndex(state);
  }

  private sortProjects(projects: Project[]): Project[] {
    return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private buildProjectRecord(input: {
    continuedFrom?: Project["continuedFrom"];
    name?: string;
    projectPath: string;
    metadata: ProjectMetadata;
    rootIds?: string[];
  }): Project {
    const now = new Date().toISOString();

    // Create an idea for every .als file in the project
    const ideas: Idea[] = input.metadata.setFiles.map((setFile) => ({
      id: createId("idea"),
      name: basename(setFile, extname(setFile)),
      createdAt: now,
      setPath: setFile,
      baseSaveId: "",
      headSaveId: "",
    }));

    // The active .als becomes currentIdeaId
    const activeIdea =
      ideas.find((i) => i.setPath === input.metadata.activeSetPath) ??
      ideas[0]!;

    return {
      id: createId("proj"),
      name: input.name?.trim() || basename(input.projectPath),
      adapter: "ableton",
      continuedFrom: input.continuedFrom ?? null,
      projectPath: input.projectPath,
      rootIds: input.rootIds ?? [],
      presence: "active",
      watchError: null,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
      currentIdeaId: activeIdea.id,
      pendingOpen: null,
      driftStatus: null,
      ideas,
      saves: [],
      watching: true,
    };
  }

  async loadState(): Promise<AppState> {
    const loaded = await this.stateRepository.load();
    const state = loaded.state;
    if (loaded.recoveredFromPrevious) {
      const alreadyReported = state.activity.some(
        (item) =>
          item.kind === "state-recovered" &&
          item.message.includes("previous generation"),
      );
      if (!alreadyReported) {
        pushActivity(
          state,
          createActivity(
            "state-recovered",
            "The latest state was unreadable. Echoform recovered the previous generation; recent metadata changes may need to be repeated.",
            "warning",
          ),
        );
        await this.stateRepository.save(state);
      }
    }
    this.refreshPathIndexes(state);
    return state;
  }

  private async saveState(state: AppState): Promise<void> {
    await this.stateRepository.save(state);
    this.refreshPathIndexes(state);
  }

  private projectHistoryDir(projectId: string): string {
    return join(this.rootDir, "history", projectId);
  }

  private async storageKeepSaveIds(project: Project): Promise<string[]> {
    const previous = await this.stateRepository.loadPrevious();
    const previousProject = previous?.projects.find(
      (candidate) => candidate.id === project.id,
    );
    return uniqueStrings([
      ...project.saves.map((save) => save.id),
      ...(previousProject?.saves.map((save) => save.id) ?? []),
    ]);
  }

  /** Commit the same destructive generation twice so both current and previous
   * state stop referencing data before that data enters trash. */
  private async commitDestructiveState(state: AppState): Promise<boolean> {
    await this.saveState(state);
    try {
      await this.saveState(state);
      return true;
    } catch {
      pushActivity(
        state,
        createActivity(
          "storage-cleanup-deferred",
          "History metadata was updated, but cleanup is waiting for the previous state generation to rotate.",
          "warning",
        ),
      );
      try {
        await this.saveState(state);
        return true;
      } catch {
        return false;
      }
    }
  }

  private async finishDestructiveCleanup(
    state: AppState,
    project: Project,
    deletedSaves: Save[],
  ): Promise<void> {
    try {
      await stageManifestsForDeletion(
        this.projectHistoryDir(project.id),
        deletedSaves.map((save) => save.id),
      );
      await gcBlobs(
        this.projectHistoryDir(project.id),
        await this.storageKeepSaveIds(project),
      );
      await Promise.all(
        deletedSaves.flatMap((save) => [
          this.clearManagedPreviewFiles(save.previewRefs),
          rm(this.analysisCachePath(project.id, save.id), { force: true }),
        ]),
      );
    } catch (error) {
      pushActivity(
        state,
        createActivity(
          "storage-cleanup-deferred",
          `${project.name}: history was updated, but storage cleanup was deferred (${error instanceof Error ? error.message : "unknown error"}).`,
          "warning",
          { projectId: project.id },
        ),
      );
      await this.saveState(state).catch(() => {});
    }
  }

  async reconcileStorage(): Promise<void> {
    await this.withLock(async () => {
      const state = await this.loadState();
      // Rotate the current logical state into the previous slot first. This
      // makes cleanup deferred by an earlier second-generation failure eligible
      // without ever deleting data referenced by a recoverable generation.
      await this.saveState(state);
      let dirty = false;
      for (const project of state.projects) {
        try {
          await gcBlobs(
            this.projectHistoryDir(project.id),
            await this.storageKeepSaveIds(project),
          );
        } catch (error) {
          dirty = true;
          pushActivity(
            state,
            createActivity(
              "storage-cleanup-deferred",
              `${project.name}: storage reconciliation failed (${error instanceof Error ? error.message : "unknown error"}).`,
              "warning",
              { projectId: project.id },
            ),
          );
        }
      }
      if (dirty) {
        await this.saveState(state);
      }
    });
  }

  private async compactProjectAutoSavesInState(
    state: AppState,
    project: Project,
  ): Promise<number> {
    const toDelete = computeAutoSavesToCompact(project);
    if (toDelete.length === 0) {
      return 0;
    }

    const deleteIds = new Set(toDelete.map((save) => save.id));
    project.saves = project.saves.filter((save) => !deleteIds.has(save.id));
    project.updatedAt = new Date().toISOString();
    if (await this.commitDestructiveState(state)) {
      await this.finishDestructiveCleanup(state, project, toDelete);
    }
    return toDelete.length;
  }

  private async shouldCompactProjectAutoSaves(
    project: Project,
  ): Promise<boolean> {
    const autoSaveCount = project.saves.filter((save) => save.auto).length;
    if (autoSaveCount > AUTO_COMPACT_MAX_AUTO_SAVES) {
      return true;
    }
    const { blobStorageBytes } = await getBlobStorageStats(
      this.projectHistoryDir(project.id),
    );
    return blobStorageBytes > AUTO_COMPACT_MAX_BLOB_STORAGE_BYTES;
  }

  /** Run a callback with exclusive state access. */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.mutex.acquire();
    try {
      return await fn();
    } finally {
      this.mutex.release();
    }
  }

  private previewExportDir(project: Project, save: Save): string {
    return join(
      homedir(),
      "Music",
      "Echoform Previews",
      slugifyProjectName(project.name),
      save.id,
    );
  }

  private managedPreviewRoot(): string {
    return join(this.rootDir, "previews");
  }

  private managedPreviewDir(projectId: string, saveId: string): string {
    return join(this.managedPreviewRoot(), projectId, saveId);
  }

  private managedPreviewPath(
    projectId: string,
    saveId: string,
    extension: string,
  ): string {
    return join(
      this.managedPreviewDir(projectId, saveId),
      `${PREVIEW_FILE_BASENAME}${extension}`,
    );
  }

  private buildPreviewRequestResult(
    project: Project,
    save: Save,
  ): PreviewRequestResult {
    return {
      projectId: project.id,
      saveId: save.id,
      status: save.previewStatus,
      folderPath: this.previewExportDir(project, save),
      expectedBaseName: PREVIEW_FILE_BASENAME,
      acceptedExtensions: [...PREVIEW_EXTENSIONS],
    };
  }

  private async clearManagedPreviewFiles(previewRefs: string[]): Promise<void> {
    const managedRoot = resolve(this.managedPreviewRoot());
    await Promise.all(
      previewRefs.map(async (previewRef) => {
        const resolved = resolve(previewRef);
        if (!resolved.startsWith(managedRoot)) {
          return;
        }
        await rm(resolved, { force: true }).catch(() => {});
      }),
    );
  }

  private async clearExportPreviewCandidates(
    folderPath: string,
  ): Promise<void> {
    const files = await readdir(folderPath).catch(() => []);
    await Promise.all(
      files.map(async (file) => {
        const extension = extname(file).toLowerCase();
        const stem = basename(file, extension);
        if (stem !== PREVIEW_FILE_BASENAME) {
          return;
        }
        await rm(join(folderPath, file), { force: true }).catch(() => {});
      }),
    );
  }

  private resetSavePreviewState(
    save: Save,
    status: PreviewStatus,
    now: string,
  ): void {
    save.previewRefs = [];
    save.previewMime = null;
    save.previewStatus = status;
    save.previewUpdatedAt = now;
  }

  private async assertDir(p: string): Promise<void> {
    const s = await stat(p).catch(() => null);
    if (!s?.isDirectory()) {
      throw new AppError(`Directory not found: ${p}`, 404);
    }
  }

  private async readProjectIdentity(
    projectPath: string,
  ): Promise<string | null> {
    const identityPath = join(
      resolveProjectStateDir(projectPath),
      "project.json",
    );
    let content: string;
    try {
      content = await readFile(identityPath, "utf8");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new AppError(
        `Project identity is corrupt at ${identityPath}.`,
        500,
      );
    }
    if (
      !(parsed && typeof parsed === "object" && "projectId" in parsed) ||
      typeof (parsed as { projectId?: unknown }).projectId !== "string"
    ) {
      throw new AppError(
        `Project identity is invalid at ${identityPath}.`,
        500,
      );
    }
    return (parsed as { projectId: string }).projectId;
  }

  async listProjects(): Promise<Project[]> {
    const state = await this.loadState();
    return this.sortProjects(state.projects);
  }

  async listRoots(): Promise<TrackedRoot[]> {
    const state = await this.loadState();
    return [...state.roots].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listActivity(): Promise<ActivityItem[]> {
    const state = await this.loadState();
    return [...state.activity];
  }

  async getSnapshot(): Promise<{
    projects: Project[];
    roots: TrackedRoot[];
    activity: ActivityItem[];
  }> {
    const state = await this.loadState();
    return {
      projects: this.sortProjects(state.projects),
      roots: [...state.roots].sort((a, b) => a.name.localeCompare(b.name)),
      activity: [...state.activity],
    };
  }

  async listRootSuggestions(): Promise<RootSuggestion[]> {
    const state = await this.loadState();
    const trackedRootPaths = new Set(
      state.roots.map((root) => resolve(root.path)),
    );
    const suggestions = await discoverRootSuggestions();
    return suggestions.filter(
      (suggestion) => !trackedRootPaths.has(resolve(suggestion.path)),
    );
  }

  async trackProject(input: {
    name?: string;
    projectPath: string;
    rootIds?: string[];
  }): Promise<Project> {
    return this.withLock(async () => {
      const projectPath = resolve(input.projectPath);
      const state = await this.loadState();
      const identity = await this.readProjectIdentity(projectPath);
      const existing = state.projects.find(
        (project) =>
          project.projectPath === projectPath || project.id === identity,
      );
      if (existing) {
        if (existing.projectPath !== projectPath) {
          for (const save of existing.saves) {
            await readManifest(this.projectHistoryDir(existing.id), save.id);
          }
          existing.projectPath = projectPath;
        }
        if (input.rootIds?.length) {
          existing.rootIds = [
            ...new Set([...existing.rootIds, ...input.rootIds]),
          ].sort();
          existing.presence = "active";
          existing.lastSeenAt = new Date().toISOString();
        }
        existing.presence = "active";
        existing.lastSeenAt = new Date().toISOString();
        existing.updatedAt = existing.lastSeenAt;
        await this.writeProjectIdentity(projectPath, existing.id);
        await this.saveState(state);
        return existing;
      }
      await this.assertDir(projectPath);
      const snapshot = await walkProject(projectPath);
      const metadata = metadataFromFiles(snapshot.files);
      const project = this.buildProjectRecord({
        name: input.name,
        projectPath,
        metadata,
        rootIds: input.rootIds,
      });
      await this.writeProjectIdentity(projectPath, project.id);
      state.projects.push(project);
      await this.saveState(state);
      return project;
    });
  }

  private async syncRootsInState(state: AppState): Promise<void> {
    const now = new Date().toISOString();
    const discoveredByPath = new Map<
      string,
      { name: string; rootIds: Set<string> }
    >();

    for (const root of state.roots) {
      root.lastScannedAt = now;
      try {
        const discovered = await discoverProjectsInRoot(root.path);
        root.lastError = null;
        for (const project of discovered) {
          const existing = discoveredByPath.get(project.path) ?? {
            name: project.name,
            rootIds: new Set<string>(),
          };
          existing.name = existing.name || project.name;
          existing.rootIds.add(root.id);
          discoveredByPath.set(project.path, existing);
        }
      } catch (err) {
        root.lastError =
          err instanceof Error ? err.message : "Could not scan this root.";
      }
    }

    const pathsByIdentity = new Map<string, string[]>();
    for (const projectPath of discoveredByPath.keys()) {
      const identity = await this.readProjectIdentity(projectPath);
      if (identity) {
        pathsByIdentity.set(identity, [
          ...(pathsByIdentity.get(identity) ?? []),
          projectPath,
        ]);
      }
    }
    for (const [identity, paths] of pathsByIdentity) {
      const project = state.projects.find(
        (candidate) => candidate.id === identity,
      );
      if (!project) {
        pushActivity(
          state,
          createActivity(
            "project-discovered",
            `Found stale project identity ${identity}; assigning a new identity.`,
            "warning",
          ),
        );
        continue;
      }
      const currentPath = paths.find((path) => path === project.projectPath);
      if (paths.length > 1) {
        pushActivity(
          state,
          createActivity(
            "project-missing",
            `${project.name} appears in multiple locations. Keeping the current path when available; use relink to choose another copy.`,
            "warning",
            { projectId: project.id },
          ),
        );
        if (!currentPath) {
          continue;
        }
      }
      const nextPath = currentPath ?? paths[0]!;
      if (project.projectPath === nextPath) {
        continue;
      }
      const occupant = state.projects.find(
        (candidate) =>
          candidate.projectPath === nextPath && candidate.id !== identity,
      );
      if (occupant) {
        throw new AppError(
          `Cannot relink ${project.name}: path is already tracked.`,
          409,
        );
      }
      for (const save of project.saves) {
        await readManifest(this.projectHistoryDir(project.id), save.id);
      }
      project.projectPath = nextPath;
      project.updatedAt = now;
    }

    const existingProjects = new Map(
      state.projects.map((project) => [project.projectPath, project]),
    );

    for (const project of state.projects) {
      const discovered = discoveredByPath.get(project.projectPath);
      const pathIdentity = await this.readProjectIdentity(project.projectPath);
      const ownsKnownPath = pathIdentity === project.id;
      const wasMissing = project.presence === "missing";
      if (discovered && ownsKnownPath) {
        project.rootIds = [...discovered.rootIds].sort();
        project.presence = "active";
        project.lastSeenAt = now;
        if (!project.name.trim()) {
          project.name = discovered.name;
        }
        if (wasMissing) {
          pushActivity(
            state,
            createActivity(
              "project-restored",
              `${project.name} is available again.`,
              "success",
              { projectId: project.id },
            ),
          );
        }
        continue;
      }

      if (ownsKnownPath) {
        project.rootIds = project.rootIds.filter((rootId) =>
          state.roots.some((root) => root.id === rootId),
        );
        project.presence = "active";
        project.lastSeenAt = now;
        if (wasMissing) {
          pushActivity(
            state,
            createActivity(
              "project-restored",
              `${project.name} is available again.`,
              "success",
              { projectId: project.id },
            ),
          );
        }
        continue;
      }

      project.rootIds = [];
      project.presence = "missing";
      if (!wasMissing) {
        pushActivity(
          state,
          createActivity(
            "project-missing",
            `${project.name} is missing from its last known location.`,
            "warning",
            { projectId: project.id },
          ),
        );
      }
    }

    for (const [projectPath, discovered] of discoveredByPath) {
      if (existingProjects.has(projectPath)) {
        continue;
      }
      const snapshot = await walkProject(projectPath);
      const metadata = metadataFromFiles(snapshot.files);
      const project = this.buildProjectRecord({
        name: discovered.name,
        projectPath,
        metadata,
        rootIds: [...discovered.rootIds].sort(),
      });
      await this.writeProjectIdentity(projectPath, project.id);
      state.projects.push(project);
      pushActivity(
        state,
        createActivity(
          "project-discovered",
          `Now protecting ${project.name}.`,
          "success",
          { projectId: project.id },
        ),
      );
    }

    state.projects = this.sortProjects(state.projects);
  }

  async syncRoots(): Promise<{
    roots: TrackedRoot[];
    projects: Project[];
    activity: ActivityItem[];
  }> {
    return this.withLock(async () => {
      const state = await this.loadState();
      await this.syncRootsInState(state);
      await this.saveState(state);
      return {
        roots: [...state.roots].sort((a, b) => a.name.localeCompare(b.name)),
        projects: this.sortProjects(state.projects),
        activity: [...state.activity],
      };
    });
  }

  async addRoot(input: { path: string; name?: string }): Promise<{
    roots: TrackedRoot[];
    projects: Project[];
    activity: ActivityItem[];
  }> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const path = resolve(input.path);
      await this.assertDir(path);

      const existing = state.roots.find((root) => root.path === path);
      if (!existing) {
        const root: TrackedRoot = {
          id: createId("root"),
          path,
          name: input.name?.trim() || basename(path),
          createdAt: new Date().toISOString(),
          lastScannedAt: null,
          lastError: null,
        };
        state.roots.push(root);
        pushActivity(
          state,
          createActivity(
            "root-added",
            `Watching folder ${root.name}.`,
            "info",
            { rootId: root.id },
          ),
        );
      }

      await this.syncRootsInState(state);
      await this.saveState(state);
      return {
        roots: [...state.roots].sort((a, b) => a.name.localeCompare(b.name)),
        projects: this.sortProjects(state.projects),
        activity: [...state.activity],
      };
    });
  }

  async removeRoot(rootId: string): Promise<{
    roots: TrackedRoot[];
    projects: Project[];
    activity: ActivityItem[];
  }> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const root = state.roots.find((candidate) => candidate.id === rootId);
      if (!root) {
        throw new AppError("Root not found.", 404);
      }
      state.roots = state.roots.filter((candidate) => candidate.id !== rootId);
      pushActivity(
        state,
        createActivity(
          "root-removed",
          `Stopped watching ${root.name}.`,
          "warning",
          { rootId },
        ),
      );
      await this.syncRootsInState(state);
      await this.saveState(state);
      return {
        roots: [...state.roots].sort((a, b) => a.name.localeCompare(b.name)),
        projects: this.sortProjects(state.projects),
        activity: [...state.activity],
      };
    });
  }

  async createSave(
    projectId: string,
    input?: { label?: string; note?: string; auto?: boolean; pinned?: boolean },
  ): Promise<{ project: Project; save: Save | null }> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const idea = requireIdea(project, project.currentIdeaId);
      return this.createSaveInState(state, project, idea, input);
    });
  }

  async requestPreview(
    projectId: string,
    saveId: string,
  ): Promise<PreviewRequestResult> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const save = requireSave(project, saveId);
      const folderPath = this.previewExportDir(project, save);
      await mkdir(folderPath, { recursive: true });

      const now = new Date().toISOString();
      if (save.previewStatus !== "pending") {
        await this.clearExportPreviewCandidates(folderPath);
        await this.clearManagedPreviewFiles(save.previewRefs);
        this.resetSavePreviewState(save, "pending", now);
        save.previewRequestedAt = now;
        project.updatedAt = now;
        await this.saveState(state);
      }

      return this.buildPreviewRequestResult(project, save);
    });
  }

  async cancelPreview(projectId: string, saveId: string): Promise<void> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const save = requireSave(project, saveId);
      if (save.previewStatus !== "pending") {
        return;
      }
      const now = new Date().toISOString();
      this.resetSavePreviewState(save, "none", now);
      save.previewRequestedAt = null;
      project.updatedAt = now;
      await this.saveState(state);
    });
  }

  async revealPreviewFolder(
    projectId: string,
    saveId: string,
  ): Promise<PreviewRequestResult> {
    const state = await this.loadState();
    const project = requireProject(state, projectId);
    const save = requireSave(project, saveId);
    const preview = this.buildPreviewRequestResult(project, save);
    await mkdir(preview.folderPath, { recursive: true });
    try {
      await this.launcher.openFile(preview.folderPath);
    } catch (err) {
      throw new AppError(
        err instanceof Error ? err.message : "Failed to reveal preview folder.",
        500,
      );
    }
    return preview;
  }

  async uploadPreview(
    projectId: string,
    saveId: string,
    fileData: ArrayBuffer,
    fileName: string,
  ): Promise<PreviewRequestResult> {
    const extension = extname(fileName).toLowerCase();
    if (!PREVIEW_EXTENSION_SET.has(extension)) {
      throw new AppError(
        `Unsupported format. Accepted: ${PREVIEW_EXTENSIONS.join(", ")}`,
        400,
      );
    }

    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const save = requireSave(project, saveId);

      await this.clearManagedPreviewFiles(save.previewRefs);

      const destinationPath = this.managedPreviewPath(
        project.id,
        save.id,
        extension,
      );
      await mkdir(dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, Buffer.from(fileData));

      const now = new Date().toISOString();
      save.previewRefs = [destinationPath];
      save.previewMime = inferPreviewMime(destinationPath);
      save.previewStatus = "ready";
      save.previewUpdatedAt = now;
      save.previewRequestedAt = save.previewRequestedAt ?? now;
      project.updatedAt = now;

      await this.saveState(state);
      return this.buildPreviewRequestResult(project, save);
    });
  }

  async ingestPendingPreviews(): Promise<boolean> {
    return this.withLock(async () => {
      const state = await this.loadState();
      let dirty = false;

      for (const project of state.projects) {
        for (const save of project.saves) {
          if (save.previewStatus !== "pending") {
            continue;
          }

          const folderPath = this.previewExportDir(project, save);
          const files = await readdir(folderPath).catch(() => null);
          if (!files) {
            continue;
          }

          // Accept any audio file with a valid extension (not just "preview.*")
          const matchingFiles = files.filter((file) => {
            const extension = extname(file).toLowerCase();
            return PREVIEW_EXTENSION_SET.has(extension);
          });

          if (matchingFiles.length === 0) {
            continue;
          }

          // If multiple audio files exist, pick the most recently modified one
          let matchedFile: string;
          if (matchingFiles.length === 1) {
            matchedFile = matchingFiles[0]!;
          } else {
            const withMtime = await Promise.all(
              matchingFiles.map(async (file) => {
                const s = await stat(join(folderPath, file)).catch(() => null);
                return { file, mtimeMs: s?.mtimeMs ?? 0 };
              }),
            );
            withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
            matchedFile = withMtime[0]?.file;
          }

          const extension = extname(matchedFile).toLowerCase();
          const sourcePath = join(folderPath, matchedFile);
          const destinationPath = this.managedPreviewPath(
            project.id,
            save.id,
            extension,
          );

          await this.clearManagedPreviewFiles(save.previewRefs);
          await mkdir(dirname(destinationPath), { recursive: true });
          await copyFile(sourcePath, destinationPath);

          const now = new Date().toISOString();
          save.previewRefs = [destinationPath];
          save.previewMime = inferPreviewMime(destinationPath);
          save.previewStatus = "ready";
          save.previewUpdatedAt = now;
          project.updatedAt = now;
          dirty = true;
        }
      }

      if (dirty) {
        await this.saveState(state);
      }

      return dirty;
    });
  }

  private baselineSaveForIdea(project: Project, idea: Idea): Save | null {
    const ideaSaves = project.saves.filter((save) => save.ideaId === idea.id);
    if (ideaSaves.length > 0) {
      return ideaSaves.at(-1) ?? null;
    }
    return null;
  }

  private setPendingOpen(
    _project: Project,
    idea: Idea,
    error: string | null,
  ): PendingOpen {
    return {
      ideaId: idea.id,
      setPath: idea.setPath,
      requestedAt: new Date().toISOString(),
      error,
    };
  }

  private setDriftStatus(
    setPath: string,
    ideaId: string | null,
    kind: DriftStatus["kind"],
  ): DriftStatus {
    return {
      kind,
      setPath,
      ideaId,
      detectedAt: new Date().toISOString(),
    };
  }

  private async createSaveInState(
    state: AppState,
    project: Project,
    idea: Idea,
    input?: { label?: string; note?: string; auto?: boolean; pinned?: boolean },
    preferredSetPath?: string,
  ): Promise<{ project: Project; save: Save | null }> {
    const expectedSetPaths = uniqueStrings(
      [preferredSetPath, idea.setPath].filter((value): value is string =>
        Boolean(value?.trim()),
      ),
    );
    const saveId = createId("save");
    const captured = await captureStoredSnapshot(
      project.projectPath,
      this.projectHistoryDir(project.id),
      saveId,
      expectedSetPaths,
    );
    const detectedMetadata = captured.metadata;
    const projectHash = captured.projectHash;
    const saveBaseline = this.baselineSaveForIdea(project, idea);

    if (
      input?.auto &&
      saveBaseline &&
      projectHash === saveBaseline.projectHash
    ) {
      await stageManifestsForDeletion(this.projectHistoryDir(project.id), [
        saveId,
      ]);
      await this.finishDestructiveCleanup(state, project, []);
      return { project, save: null };
    }

    const resolvedSetPath = resolveIdeaSetPath(
      detectedMetadata,
      idea.setPath,
      preferredSetPath,
    );
    const metadata =
      detectedMetadata.activeSetPath === resolvedSetPath
        ? detectedMetadata
        : {
            ...detectedMetadata,
            activeSetPath: resolvedSetPath,
          };
    const now = new Date().toISOString();

    const changes = saveBaseline
      ? await computeManifestChangeSummary(
          this.projectHistoryDir(project.id),
          saveBaseline,
          saveId,
          metadata,
        )
      : undefined;
    const save: Save = {
      id: saveId,
      label: input?.label?.trim() || autoLabel(),
      customLabel: Boolean(input?.label?.trim()),
      note: input?.note?.trim() || "",
      pinned: input?.pinned ?? false,
      createdAt: now,
      ideaId: idea.id,
      previewRefs: [],
      previewStatus: "none",
      previewMime: null,
      previewRequestedAt: null,
      previewUpdatedAt: null,
      projectHash,
      metadata,
      auto: input?.auto ?? false,
      changes,
    };
    project.saves.push(save);
    idea.headSaveId = save.id;
    if (!idea.baseSaveId) {
      idea.baseSaveId = save.id;
    }
    idea.setPath = resolvedSetPath;
    project.pendingOpen =
      project.pendingOpen?.ideaId === idea.id ? null : project.pendingOpen;
    project.driftStatus = null;
    project.updatedAt = now;
    project.presence = "active";
    project.lastSeenAt = now;
    project.watchError = null;

    if (save.auto) {
      pushActivity(
        state,
        createActivity(
          "auto-saved",
          `Saved ${project.name}: ${save.label}`,
          "success",
          { projectId: project.id },
        ),
      );
    }

    try {
      await this.saveState(state);
    } catch (err) {
      await stageManifestsForDeletion(this.projectHistoryDir(project.id), [
        saveId,
      ]);
      throw err;
    }
    await this.finishDestructiveCleanup(state, project, []);

    if (save.auto && (await this.shouldCompactProjectAutoSaves(project))) {
      await this.compactProjectAutoSavesInState(state, project);
    }

    return { project, save };
  }

  private async openIdeaInState(
    state: AppState,
    project: Project,
    idea: Idea,
  ): Promise<{ project: Project; openError?: string }> {
    const absolutePath = resolveProjectFilePath(
      project.projectPath,
      idea.setPath,
    );

    try {
      await access(absolutePath);
    } catch {
      project.driftStatus = this.setDriftStatus(
        idea.setPath,
        idea.id,
        "missing-file",
      );
      project.pendingOpen = null;
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);
      return { project, openError: "Branch file is missing on disk." };
    }

    try {
      await this.launcher.openFile(absolutePath);
      project.currentIdeaId = idea.id;
      project.pendingOpen = null;
      project.driftStatus = null;
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);
      return { project };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to open branch file.";
      project.pendingOpen = this.setPendingOpen(project, idea, message);
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);
      return { project, openError: message };
    }
  }

  async openIdea(
    projectId: string,
    ideaId: string,
  ): Promise<{ project: Project; openError?: string }> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const idea = requireIdea(project, ideaId);
      return this.openIdeaInState(state, project, idea);
    });
  }

  async revealIdeaFile(
    projectId: string,
    ideaId: string,
  ): Promise<{ project: Project; openError?: string }> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const idea = requireIdea(project, ideaId);
      const absolutePath = resolveProjectFilePath(
        project.projectPath,
        idea.setPath,
      );

      try {
        await access(absolutePath);
        await this.launcher.revealFile(absolutePath);
        return { project };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to reveal branch file.";
        project.driftStatus = this.setDriftStatus(
          idea.setPath,
          idea.id,
          "missing-file",
        );
        project.updatedAt = new Date().toISOString();
        await this.saveState(state);
        return { project, openError: message };
      }
    });
  }

  async adoptDriftFile(projectId: string): Promise<Project> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const drift = project.driftStatus;
      if (!drift || drift.kind !== "unknown-file") {
        throw new AppError("No drifted Ableton file to adopt.", 409);
      }
      const currentIdea = requireIdea(project, project.currentIdeaId);
      currentIdea.setPath = drift.setPath;
      project.driftStatus = null;
      project.pendingOpen = null;
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);
      return project;
    });
  }

  async handleWatchedAlsChange(
    projectId: string,
    changedPaths: string | string[],
  ): Promise<{ project: Project; save: Save | null; stateChanged: boolean }> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const relativeSetPaths = uniqueStrings(
        (Array.isArray(changedPaths) ? changedPaths : [changedPaths]).map(
          (changedPath) =>
            changePathToRelativeSetPath(project.projectPath, changedPath),
        ),
      );
      if (relativeSetPaths.length === 0) {
        throw new AppError("No changed Ableton file was provided.", 400);
      }
      const index =
        this.ideaPathIndex.get(project.id) ?? new Map<string, string>();
      const currentIdea = requireIdea(project, project.currentIdeaId);

      const changedCandidates = relativeSetPaths.map((relativeSetPath) => ({
        relativeSetPath,
        ideaId:
          index.get(
            normalizeAbsolutePath(
              resolveProjectFilePath(project.projectPath, relativeSetPath),
            ),
          ) ?? null,
      }));

      const currentCandidate = changedCandidates.find(
        (candidate) => candidate.ideaId === currentIdea.id,
      );
      const knownCandidates = changedCandidates.filter(
        (candidate) => candidate.ideaId !== null,
      );

      const preferredCandidate =
        currentCandidate ??
        (knownCandidates.length === 1 ? knownCandidates[0]! : null) ??
        changedCandidates[0]!;

      let stateChanged = false;
      let resolvedIdeaId = preferredCandidate.ideaId;

      if (!resolvedIdeaId) {
        // Auto-create an idea/branch for this previously-unseen .als file
        const now = new Date().toISOString();
        const ideaName = basename(
          preferredCandidate.relativeSetPath,
          extname(preferredCandidate.relativeSetPath),
        );
        const newIdea: Idea = {
          id: createId("idea"),
          name: ensureUniqueIdeaName(project, ideaName),
          createdAt: now,
          setPath: preferredCandidate.relativeSetPath,
          baseSaveId: "",
          headSaveId: "",
        };
        project.ideas.push(newIdea);
        resolvedIdeaId = newIdea.id;
        stateChanged = true;
      }

      if (project.currentIdeaId !== resolvedIdeaId) {
        project.currentIdeaId = resolvedIdeaId;
        stateChanged = true;
      }
      if (project.presence !== "active") {
        project.presence = "active";
        stateChanged = true;
      }
      if (project.watchError) {
        project.watchError = null;
        stateChanged = true;
      }
      project.lastSeenAt = new Date().toISOString();
      if (project.pendingOpen?.ideaId === resolvedIdeaId) {
        project.pendingOpen = null;
        stateChanged = true;
      }
      if (project.driftStatus) {
        project.driftStatus = null;
        stateChanged = true;
      }

      const idea = requireIdea(project, resolvedIdeaId);
      const result = await this.createSaveInState(
        state,
        project,
        idea,
        { auto: true },
        preferredCandidate.relativeSetPath,
      );
      if (!result.save && stateChanged) {
        project.updatedAt = new Date().toISOString();
        await this.saveState(state);
      }
      return {
        project,
        save: result.save,
        stateChanged: stateChanged || result.save !== null,
      };
    });
  }

  async compareSaves(
    projectId: string,
    leftId: string,
    rightId: string,
  ): Promise<CompareResult> {
    const state = await this.loadState();
    const project = requireProject(state, projectId);
    const l = requireSave(project, leftId);
    const r = requireSave(project, rightId);
    return {
      leftSave: l,
      rightSave: r,
      leftIdea: requireIdea(project, l.ideaId),
      rightIdea: requireIdea(project, r.ideaId),
      noteChanged: l.note !== r.note,
      previewRefs: { left: l.previewRefs, right: r.previewRefs },
      metadataDelta: {
        fileCount: r.metadata.fileCount - l.metadata.fileCount,
        audioFiles: r.metadata.audioFiles - l.metadata.audioFiles,
        sizeBytes: r.metadata.sizeBytes - l.metadata.sizeBytes,
        setCount: r.metadata.setFiles.length - l.metadata.setFiles.length,
        activeSetChanged: r.metadata.activeSetPath !== l.metadata.activeSetPath,
        modifiedAt: {
          left: l.metadata.modifiedAt,
          right: r.metadata.modifiedAt,
        },
      },
    };
  }

  async updateSave(
    projectId: string,
    saveId: string,
    input: { note?: string; label?: string; pinned?: boolean },
  ): Promise<Project> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const save = requireSave(project, saveId);
      if (input.note !== undefined) {
        save.note = input.note;
      }
      if (input.label !== undefined) {
        const nextLabel = input.label.trim();
        save.label = nextLabel;
        save.customLabel = nextLabel.length > 0;
      }
      if (input.pinned !== undefined) {
        save.pinned = input.pinned;
      }
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);
      return project;
    });
  }

  async toggleWatching(projectId: string, watching: boolean): Promise<Project> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      project.watching = watching;
      if (watching) {
        project.watchError = null;
      }
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);
      return project;
    });
  }

  async setProjectWatchError(
    projectId: string,
    message: string,
  ): Promise<Project> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      project.watchError = message;
      project.updatedAt = new Date().toISOString();
      pushActivity(
        state,
        createActivity(
          "watcher-error",
          `${project.name}: ${message}`,
          "error",
          { projectId: project.id },
        ),
      );
      await this.saveState(state);
      return project;
    });
  }

  async clearProjectWatchError(projectId: string): Promise<Project> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      if (!project.watchError) {
        return project;
      }
      project.watchError = null;
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);
      return project;
    });
  }

  async deleteProject(projectId: string): Promise<Project[]> {
    return this.withLock(async () => {
      const state = await this.loadState();
      requireProject(state, projectId);
      state.projects = state.projects.filter(
        (project) => project.id !== projectId,
      );
      await this.saveState(state);
      this.ideaPathIndex.delete(projectId);
      return [...state.projects].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
    });
  }

  async deleteSave(projectId: string, saveId: string): Promise<Project> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const save = requireSave(project, saveId);
      project.saves = project.saves.filter((s) => s.id !== saveId);
      for (const idea of project.ideas) {
        if (idea.headSaveId === saveId) {
          const ideaSaves = project.saves.filter((s) => s.ideaId === idea.id);
          idea.headSaveId = ideaSaves.at(-1)?.id ?? "";
        }
        if (idea.baseSaveId === saveId) {
          idea.baseSaveId = idea.headSaveId;
        }
      }
      project.updatedAt = new Date().toISOString();
      if (await this.commitDestructiveState(state)) {
        await this.finishDestructiveCleanup(state, project, [save]);
      }
      return project;
    });
  }

  async recoverSave(
    projectId: string,
    saveId: string,
    open = true,
  ): Promise<RecoveryResult> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const sourceProject = requireProject(state, projectId);
      const sourceSave = requireSave(sourceProject, saveId);
      const recoveredCopy = await recoverStoredSnapshot({
        activeSetPath: sourceSave.metadata.activeSetPath,
        historyDir: this.projectHistoryDir(sourceProject.id),
        projectName: sourceProject.name,
        recoveryRoot: this.recoveryRoot,
        saveId,
      });
      const snapshot = await walkProject(recoveredCopy.recoveredPath);
      const metadata = metadataFromFiles(
        snapshot.files,
        sourceSave.metadata.activeSetPath,
      );
      const recoveredProject = this.buildProjectRecord({
        continuedFrom: {
          projectId: sourceProject.id,
          saveId: sourceSave.id,
        },
        name: `Branch of ${sourceProject.name}`,
        projectPath: recoveredCopy.recoveredPath,
        metadata,
      });
      state.projects.push(recoveredProject);
      try {
        await this.writeProjectIdentity(
          recoveredProject.projectPath,
          recoveredProject.id,
        );
        const idea = requireIdea(
          recoveredProject,
          recoveredProject.currentIdeaId,
        );
        const checkpoint = await this.createSaveInState(
          state,
          recoveredProject,
          idea,
          {
            label: `Continued from ${sourceSave.label}`,
            note: `Recovered from ${sourceProject.name} save ${sourceSave.id}.`,
            pinned: true,
          },
          sourceSave.metadata.activeSetPath,
        );
        if (!checkpoint.save) {
          throw new Error("Initial recovery checkpoint was not created.");
        }
      } catch (error) {
        state.projects = state.projects.filter(
          (candidate) => candidate.id !== recoveredProject.id,
        );
        await rm(recoveredCopy.recoveredPath, {
          recursive: true,
          force: true,
        }).catch(() => {});
        await rm(this.projectHistoryDir(recoveredProject.id), {
          recursive: true,
          force: true,
        }).catch(() => {});
        throw error;
      }

      let openError: string | null = null;
      if (open) {
        try {
          await this.launcher.openFile(recoveredCopy.activeSetPath);
        } catch (error) {
          openError =
            error instanceof Error ? error.message : "Failed to open Ableton.";
        }
      }
      return {
        activeSetPath: recoveredCopy.activeSetPath,
        openError,
        recoveredProjectId: recoveredProject.id,
        recoveredPath: recoveredCopy.recoveredPath,
        sourceProjectId: sourceProject.id,
        sourceSaveId: sourceSave.id,
      };
    });
  }

  private async writeProjectIdentity(
    projectPath: string,
    projectId: string,
  ): Promise<void> {
    const identityPath = join(
      resolveProjectStateDir(projectPath),
      "project.json",
    );
    await mkdir(dirname(identityPath), { recursive: true });
    const temporaryPath = `${identityPath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ projectId }, null, 2), {
      flush: true,
    });
    await rename(temporaryPath, identityPath);
  }

  async relinkProject(
    projectId: string,
    projectPathInput: string,
  ): Promise<Project> {
    return this.withLock(async () => {
      const projectPath = resolve(projectPathInput);
      await this.assertDir(projectPath);
      const snapshot = await walkProject(projectPath);
      metadataFromFiles(snapshot.files);
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const occupant = state.projects.find(
        (candidate) =>
          candidate.id !== projectId && candidate.projectPath === projectPath,
      );
      if (occupant) {
        throw new AppError(
          `Cannot relink: ${projectPath} is already tracked as ${occupant.name}.`,
          409,
        );
      }
      const pathIdentity = await this.readProjectIdentity(projectPath);
      if (pathIdentity && pathIdentity !== projectId) {
        throw new AppError(
          `Cannot relink: ${projectPath} belongs to another project identity.`,
          409,
        );
      }
      for (const save of project.saves) {
        await readManifest(this.projectHistoryDir(project.id), save.id);
      }
      const previousIdentity = pathIdentity;
      await this.writeProjectIdentity(projectPath, project.id);
      project.projectPath = projectPath;
      project.presence = "active";
      project.lastSeenAt = new Date().toISOString();
      project.updatedAt = project.lastSeenAt;
      project.watchError = null;
      try {
        await this.saveState(state);
      } catch (error) {
        if (previousIdentity) {
          await this.writeProjectIdentity(projectPath, previousIdentity).catch(
            () => {},
          );
        } else {
          await rm(join(resolveProjectStateDir(projectPath), "project.json"), {
            force: true,
          }).catch(() => {});
        }
        throw error;
      }
      return project;
    });
  }

  private async markPreviewMissing(
    projectId: string,
    saveId: string,
    previewPath: string,
  ): Promise<void> {
    await this.withLock(async () => {
      const state = await this.loadState();
      const project = state.projects.find(
        (candidate) => candidate.id === projectId,
      );
      const save = project?.saves.find((candidate) => candidate.id === saveId);
      if (!(project && save)) {
        return;
      }
      if (
        !save.previewRefs.some(
          (previewRef) => resolve(previewRef) === previewPath,
        )
      ) {
        return;
      }
      const now = new Date().toISOString();
      this.resetSavePreviewState(save, "missing", now);
      project.updatedAt = now;
      await this.saveState(state);
    });
  }

  async resolvePreviewPath(p: string): Promise<string> {
    const resolved = resolve(p);
    const previewOwner = this.previewPathIndex.get(resolved);
    if (!previewOwner) {
      throw new AppError("File not found", 404);
    }
    try {
      await access(resolved);
    } catch {
      await this.markPreviewMissing(
        previewOwner.projectId,
        previewOwner.saveId,
        resolved,
      );
      throw new AppError("File not found", 404);
    }
    return resolved;
  }

  /** Compute changes for a save that doesn't have them yet (backfill). */
  // ── Analysis ────────────────────────────────────────────────────

  /** The checkpoint a save is compared with: the one before it in the same set. */
  private previousSaveInIdea(project: Project, save: Save): Save | null {
    return (
      project.saves
        .filter((s) => s.ideaId === save.ideaId && s.createdAt < save.createdAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  private analysisCachePath(projectId: string, saveId: string): string {
    return join(this.projectHistoryDir(projectId), "analysis", `${saveId}.json`);
  }

  /** Parsing a large set takes about a second; neighbouring saves share sets. */
  private readLiveSetCached(blobPath: string): Promise<LiveSet> {
    const cached = this.liveSetCache.get(blobPath);
    if (cached) {
      this.liveSetCache.delete(blobPath);
      this.liveSetCache.set(blobPath, cached);
      return cached;
    }
    const pending = readLiveSet(blobPath);
    pending.catch(() => this.liveSetCache.delete(blobPath));
    this.liveSetCache.set(blobPath, pending);
    while (this.liveSetCache.size > LIVE_SET_CACHE_SIZE) {
      const oldest = this.liveSetCache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.liveSetCache.delete(oldest);
    }
    return pending;
  }

  private async liveSetForSave(
    projectId: string,
    save: Save,
  ): Promise<LiveSet | null> {
    const historyDir = this.projectHistoryDir(projectId);
    const hash = await findAlsHashForSave(
      historyDir,
      save.id,
      save.metadata.activeSetPath,
    );
    return hash ? this.readLiveSetCached(getBlobPath(historyDir, hash)) : null;
  }

  /**
   * Compare a checkpoint's Ableton set with the previous checkpoint of the same
   * set. Reads only from Echoform's history, so it works after the working
   * folder is gone. Results are cached on disk and the compact summary is
   * stored on the save.
   */
  async getSaveAnalysis(
    projectId: string,
    saveId: string,
  ): Promise<{ analysis: SaveAnalysis; project: Project | null }> {
    const { save, previous } = await this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const target = requireSave(project, saveId);
      return { previous: this.previousSaveInIdea(project, target), save: target };
    });
    const baseSaveId = previous?.id ?? null;
    const cachePath = this.analysisCachePath(projectId, saveId);

    let analysis: SaveAnalysis | null = null;
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8")) as SaveAnalysis;
      if (
        cached.baseSaveId === baseSaveId &&
        cached.summary.version === ANALYSIS_VERSION
      ) {
        analysis = cached;
      }
    } catch {
      // No usable cache; analyze below.
    }

    if (!analysis) {
      const after = await this.liveSetForSave(projectId, save);
      if (!after) {
        throw new AppError("This checkpoint has no Ableton set to analyze.", 404);
      }
      const before = previous ? await this.liveSetForSave(projectId, previous) : null;
      analysis = analyzeSets(before, after, baseSaveId);
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify(analysis));
    }

    const project = await this.storeSummary(projectId, saveId, analysis.summary);
    return { analysis, project };
  }

  /** Persist a summary if it differs; returns the project when state changed. */
  private async storeSummary(
    projectId: string,
    saveId: string,
    summary: SaveSummary,
  ): Promise<Project | null> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = state.projects.find((p) => p.id === projectId);
      const save = project?.saves.find((s) => s.id === saveId);
      if (!(project && save) || isSameSummary(save.summary, summary)) {
        return null;
      }
      save.summary = summary;
      await this.saveState(state);
      return project;
    });
  }

  /**
   * Summarize the newest checkpoint whose summary is missing or stale.
   * Returns the updated project, or null when everything is current.
   */
  async summarizeNextSave(): Promise<Project | null | undefined> {
    const next = await this.withLock(async () => {
      const state = await this.loadState();
      const candidates = state.projects.flatMap((project) =>
        project.saves
          .filter((save) => !this.unreadableSaves.has(save.id))
          .filter((save) => {
            const summary = save.summary;
            return (
              !summary ||
              summary.version !== ANALYSIS_VERSION ||
              summary.baseSaveId !==
                (this.previousSaveInIdea(project, save)?.id ?? null)
            );
          })
          .map((save) => ({ createdAt: save.createdAt, projectId: project.id, saveId: save.id })),
      );
      return candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    });
    if (!next) {
      return undefined;
    }
    try {
      const { project } = await this.getSaveAnalysis(next.projectId, next.saveId);
      return project;
    } catch {
      // Unreadable or unparseable set; don't retry it this session.
      this.unreadableSaves.add(next.saveId);
      return null;
    }
  }

  /** Get disk usage statistics for a project. */
  async getDiskUsage(projectId: string): Promise<DiskUsage> {
    const state = await this.loadState();
    const project = requireProject(state, projectId);
    const historyDir = this.projectHistoryDir(project.id);
    const { blobStorageBytes, blobCount } =
      await getBlobStorageStats(historyDir);

    // Count manifests
    const manifestsDirPath = join(historyDir, "manifests");
    let manifestCount = 0;
    try {
      const entries = await readdir(manifestsDirPath);
      manifestCount = entries.filter((e) => e.endsWith(".json")).length;
    } catch (error) {
      if (!isErrno(error, "ENOENT")) {
        throw error;
      }
    }

    const autoSaves = project.saves
      .filter((s) => s.auto)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const manualSaves = project.saves.filter((s) => !s.auto);
    const eligibleAutoSaves = computeAutoSavesToCompact(project);
    const totalSnapshotBytes = project.saves.reduce(
      (sum, s) => sum + s.metadata.sizeBytes,
      0,
    );

    return {
      projectId,
      blobStorageBytes,
      blobCount,
      manifestCount,
      totalSaveCount: project.saves.length,
      autoSaveCount: autoSaves.length,
      manualSaveCount: manualSaves.length,
      totalSnapshotBytes,
      dedupSavings: Math.max(0, totalSnapshotBytes - blobStorageBytes),
      eligibleAutoSaveCount: eligibleAutoSaves.length,
      oldestAutoSaveAt: autoSaves[0]?.createdAt ?? null,
      largestAutoSaveBytes: autoSaves.reduce(
        (largest, save) => Math.max(largest, save.metadata.sizeBytes),
        0,
      ),
      saves: project.saves.map((s) => ({
        id: s.id,
        label: s.label,
        customLabel: s.customLabel,
        createdAt: s.createdAt,
        snapshotBytes: s.metadata.sizeBytes,
        auto: s.auto,
      })),
    };
  }

  async compactStorage(
    projectId: string,
  ): Promise<{ project: Project; deletedCount: number }> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const deletedCount = await this.compactProjectAutoSavesInState(
        state,
        project,
      );
      return { project, deletedCount };
    });
  }

  /** Delete auto-saves older than the given number of days. Returns deleted count. */
  async pruneSaves(
    projectId: string,
    olderThanDays: number,
  ): Promise<{ project: Project; deletedCount: number }> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - olderThanDays);
      const cutoffIso = cutoff.toISOString();

      // Find auto-saves older than cutoff, but never delete head saves
      const protectedSaveIds = getProtectedSaveIds(project);
      const toDelete = project.saves.filter(
        (s) => s.auto && s.createdAt < cutoffIso && !protectedSaveIds.has(s.id),
      );

      if (toDelete.length === 0) {
        return { project, deletedCount: 0 };
      }

      const deleteIds = new Set(toDelete.map((s) => s.id));
      project.saves = project.saves.filter((s) => !deleteIds.has(s.id));
      project.updatedAt = new Date().toISOString();
      if (await this.commitDestructiveState(state)) {
        await this.finishDestructiveCleanup(state, project, toDelete);
      }

      return { project, deletedCount: toDelete.length };
    });
  }
}
