import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  copyFile,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import type {
  ActivityItem,
  AppState,
  ChangeSummary,
  CompareResult,
  DriftStatus,
  DiskUsage,
  Idea,
  PendingOpen,
  Project,
  ProjectMetadata,
  RootSuggestion,
  Save,
  SmartRestoreResult,
  SmartRestoreTrack,
  SetDiff,
  TrackedRoot,
  TrackSummaryItem,
} from './types';
import type { Manifest, ManifestEntry } from './blob-store';
import {
  createManifest,
  deleteManifest,
  gcBlobs,
  getBlobPath,
  readManifest,
  storeBlob,
} from './blob-store';
import { parseAlsFile, extractTrackSummary } from './als-parser';
import type { SetSnapshot } from './als-parser';
import { diffSets, isEmptyDiff } from './als-diff';
import { formatDiffAsLabel } from './smart-naming';
import { listRestorableTracks, smartRestoreTracks } from './smart-restore';
import type { AbletonLauncher } from './branch-files';
import {
  buildAbsolutePathIndex,
  buildDefaultBranchFileName,
  buildUniqueBranchSetPath,
  changePathToRelativeSetPath,
  createAbletonLauncher,
  dirnameOfSetPath,
  normalizeAbsolutePath,
  normalizeRelativeSetPath,
  resolveProjectFilePath,
} from './branch-files';
import { discoverProjectsInRoot, discoverRootSuggestions } from './discovery';

const AUDIO_EXTENSIONS = new Set([
  '.aif',
  '.aiff',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.wav',
]);

type FileRecord = { relativePath: string; size: number; mtimeMs: number };
type ProjectSnapshot = { files: FileRecord[]; emptyDirs: string[] };
const MAX_ACTIVITY_ITEMS = 80;
const SAVE_SETTLE_RETRY_MS = 200;
const SAVE_SETTLE_MAX_ATTEMPTS = 8;

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createActivity(
  kind: ActivityItem['kind'],
  message: string,
  severity: ActivityItem['severity'],
  extra: Pick<ActivityItem, 'rootId' | 'projectId'> = {},
): ActivityItem {
  return {
    id: createId('activity'),
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
  if (!p) throw new AppError('Project not found.', 404);
  return p;
}

function requireIdea(project: Project, id: string): Idea {
  const i = project.ideas.find((x) => x.id === id);
  if (!i) throw new AppError('Idea not found.', 404);
  return i;
}

function requireSave(project: Project, id: string): Save {
  const s = project.saves.find((x) => x.id === id);
  if (!s) throw new AppError('Save not found.', 404);
  return s;
}

function isIdeaNameTaken(project: Project, name: string): boolean {
  return project.ideas.some((i) => i.name.toLowerCase() === name.toLowerCase());
}

function ensureUniqueIdeaName(project: Project, baseName: string): string {
  const trimmed = baseName.trim() || 'Recovered version';
  if (!isIdeaNameTaken(project, trimmed)) return trimmed;
  let n = 2;
  while (isIdeaNameTaken(project, `${trimmed} ${n}`)) n++;
  return `${trimmed} ${n}`;
}

function buildRecoveredIdeaName(project: Project, fromSave: Save): string {
  const source = fromSave.label.trim() || 'version';
  return ensureUniqueIdeaName(project, `Recovered ${source}`);
}

function createBranchIdea(
  project: Project,
  fromSave: Save,
  name: string,
  setPath: string,
): Idea {
  const now = new Date().toISOString();
  return {
    id: createId('idea'),
    name: ensureUniqueIdeaName(project, name),
    createdAt: now,
    setPath,
    baseSaveId: fromSave.id,
    headSaveId: fromSave.id,
    parentIdeaId: fromSave.ideaId,
    forkedFromSaveId: fromSave.id,
  };
}

function deriveIdeaSetPath(project: Project, idea: Idea): string {
  if ('setPath' in idea && typeof idea.setPath === 'string' && idea.setPath) {
    return normalizeRelativeSetPath(idea.setPath);
  }
  const ideaSaves = project.saves
    .filter((save) => save.ideaId === idea.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (ideaSaves.length > 0) {
    return normalizeRelativeSetPath(ideaSaves.at(-1)!.metadata.activeSetPath);
  }
  if (idea.forkedFromSaveId) {
    const forkSave = project.saves.find(
      (save) => save.id === idea.forkedFromSaveId,
    );
    if (forkSave) {
      return normalizeRelativeSetPath(forkSave.metadata.activeSetPath);
    }
  }
  if ('activeSetPath' in project && typeof project.activeSetPath === 'string') {
    return normalizeRelativeSetPath(project.activeSetPath);
  }
  return 'project.als';
}

function migrateIdea(project: Project, idea: Idea): Idea {
  return {
    ...idea,
    setPath: deriveIdeaSetPath(project, idea),
    parentIdeaId: idea.parentIdeaId ?? null,
    forkedFromSaveId: idea.forkedFromSaveId ?? null,
  };
}

function migrateProject(project: Project): Project {
  const ideas = project.ideas.map((idea) => migrateIdea(project, idea));
  const lastSeenAt =
    'lastSeenAt' in project && typeof project.lastSeenAt !== 'undefined'
      ? project.lastSeenAt
      : project.updatedAt;
  return {
    ...project,
    rootIds:
      ('rootIds' in project && Array.isArray(project.rootIds)
        ? project.rootIds
        : []) ?? [],
    presence:
      ('presence' in project ? project.presence : 'active') === 'missing'
        ? 'missing'
        : 'active',
    watchError: ('watchError' in project ? project.watchError : null) ?? null,
    lastSeenAt: lastSeenAt ?? null,
    pendingOpen:
      ('pendingOpen' in project ? project.pendingOpen : null) ?? null,
    driftStatus:
      ('driftStatus' in project ? project.driftStatus : null) ?? null,
    ideas,
  };
}

function migrateState(state: AppState): AppState {
  return {
    roots:
      ('roots' in state ? state.roots : [])
        ?.filter((root): root is TrackedRoot => Boolean(root?.path))
        .map((root) => ({
          id:
            typeof root.id === 'string' && root.id.length > 0
              ? root.id
              : createId('root'),
          path: resolve(root.path),
          name: root.name || basename(root.path),
          createdAt: root.createdAt ?? new Date().toISOString(),
          lastScannedAt: root.lastScannedAt ?? null,
          lastError: root.lastError ?? null,
        })) ?? [],
    projects: state.projects.map(migrateProject),
    activity:
      ('activity' in state ? state.activity : [])
        ?.filter((item): item is ActivityItem => Boolean(item?.message))
        .slice(0, MAX_ACTIVITY_ITEMS) ?? [],
  };
}

// ── Filesystem helpers ──────────────────────────────────────────────

async function walkProject(
  rootPath: string,
  currentPath = rootPath,
): Promise<ProjectSnapshot> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files: FileRecord[] = [];
  const emptyDirs: string[] = [];
  for (const entry of entries) {
    const abs = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.ablegit-state') continue;
      const child = await walkProject(rootPath, abs);
      if (child.files.length === 0 && child.emptyDirs.length === 0) {
        emptyDirs.push(relative(rootPath, abs));
      } else {
        files.push(...child.files);
        emptyDirs.push(...child.emptyDirs);
      }
      continue;
    }
    const s = await stat(abs);
    files.push({
      relativePath: relative(rootPath, abs),
      size: s.size,
      mtimeMs: s.mtimeMs,
    });
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  emptyDirs.sort((a, b) => a.localeCompare(b));
  return { files, emptyDirs };
}

function hashFiles(files: FileRecord[]): string {
  const h = createHash('sha256');
  for (const f of files) h.update(`${f.relativePath}:${f.size}:${f.mtimeMs}\n`);
  return h.digest('hex');
}

function hashProject(snapshot: ProjectSnapshot): string {
  const h = createHash('sha256');
  for (const f of snapshot.files) {
    h.update(`file:${f.relativePath}:${f.size}:${f.mtimeMs}\n`);
  }
  for (const dir of snapshot.emptyDirs) h.update(`dir:${dir}\n`);
  return h.digest('hex');
}

function matchesProjectHash(
  snapshot: ProjectSnapshot,
  expectedHash: string,
): boolean {
  return (
    hashProject(snapshot) === expectedHash ||
    hashFiles(snapshot.files) === expectedHash
  );
}

function metadataFromFiles(
  files: FileRecord[],
  preferred?: string,
): ProjectMetadata {
  const isBackup = (p: string) =>
    p.startsWith('Backup/') || p.startsWith('Backup\\');
  const setFiles = files
    .filter(
      (f) =>
        extname(f.relativePath).toLowerCase() === '.als' &&
        !isBackup(f.relativePath),
    )
    .map((f) => f.relativePath)
    .sort();
  if (setFiles.length === 0)
    throw new AppError('No Ableton .als file found in the project folder.');
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

function manifestFileEntries(
  entries: ManifestEntry[],
): Array<ManifestEntry & { blobHash: string; size: number; mtimeMs?: number }> {
  return entries.filter(
    (
      entry,
    ): entry is ManifestEntry & {
      blobHash: string;
      size: number;
      mtimeMs?: number;
    } =>
      entry.type !== 'dir',
  );
}

function buildManifestFileIndex(
  entries: ManifestEntry[],
): Map<
  string,
  ManifestEntry & { blobHash: string; size: number; mtimeMs?: number }
> {
  return new Map(
    manifestFileEntries(entries).map((entry) => [entry.relativePath, entry]),
  );
}

/** Build a file-diff summary from two manifest entry lists. */
function diffManifestEntries(
  prev: ManifestEntry[],
  curr: ManifestEntry[],
): Omit<ChangeSummary, 'sizeDelta'> {
  const prevMap = new Map(
    manifestFileEntries(prev).map((f) => [f.relativePath, f]),
  );
  const currMap = new Map(
    manifestFileEntries(curr).map((f) => [f.relativePath, f]),
  );
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const skip = (p: string) =>
    extname(p).toLowerCase() === '.als' ||
    p.startsWith('Backup/') ||
    p.startsWith('Backup\\');
  for (const [path, file] of currMap) {
    if (skip(path)) continue;
    const old = prevMap.get(path);
    if (!old) addedFiles.push(path);
    else if (old.blobHash !== file.blobHash) modifiedFiles.push(path);
  }
  for (const path of prevMap.keys()) {
    if (skip(path)) continue;
    if (!currMap.has(path)) removedFiles.push(path);
  }
  return { addedFiles, removedFiles, modifiedFiles };
}

function autoLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function captureSettledSnapshot(
  projectPath: string,
  expectedSetPaths: string[],
): Promise<{ snapshot: ProjectSnapshot; metadata: ProjectMetadata }> {
  let lastSnapshot: ProjectSnapshot | null = null;
  let lastMetadata: ProjectMetadata | null = null;

  for (let attempt = 0; attempt < SAVE_SETTLE_MAX_ATTEMPTS; attempt++) {
    const snapshot = await walkProject(projectPath);
    const metadata = metadataFromFiles(snapshot.files, expectedSetPaths[0]);
    lastSnapshot = snapshot;
    lastMetadata = metadata;

    if (
      expectedSetPaths.length === 0 ||
      expectedSetPaths.some((setPath) => metadata.setFiles.includes(setPath))
    ) {
      return { snapshot, metadata };
    }

    if (attempt < SAVE_SETTLE_MAX_ATTEMPTS - 1) {
      await sleep(SAVE_SETTLE_RETRY_MS);
    }
  }

  throw new AppError(
    `Ableton save did not settle for ${expectedSetPaths[0] ?? 'the current set'}. Refusing to create a corrupted tab.`,
    409,
  );
}

/** Attempt to compute the semantic .als diff between two .als blob paths.
 *  Returns the diff and the current snapshot. Never throws. */
async function tryComputeSetDiff(
  prevAlsPath: string,
  currAlsPath: string,
): Promise<{
  diff: SetDiff | undefined;
  currSnapshot: SetSnapshot | undefined;
}> {
  try {
    const [prevSnapshot, currSnapshot] = await Promise.all([
      parseAlsFile(prevAlsPath),
      parseAlsFile(currAlsPath),
    ]);
    const diff = diffSets(prevSnapshot, currSnapshot);
    return {
      diff: isEmptyDiff(diff) ? undefined : diff,
      currSnapshot,
    };
  } catch {
    return { diff: undefined, currSnapshot: undefined };
  }
}

/** Parse a single .als file for track summary. Never throws. */
async function tryParseSnapshot(
  alsPath: string,
): Promise<SetSnapshot | undefined> {
  try {
    return await parseAlsFile(alsPath);
  } catch {
    return undefined;
  }
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

/** Find the blob hash for a previous save's active .als file by reading its manifest. */
async function findPrevAlsHash(
  projectPath: string,
  prevSave: Save,
): Promise<string | null> {
  try {
    const manifest = await readManifest(projectPath, prevSave.id);
    return findAlsHashInEntries(
      manifest.files,
      prevSave.metadata.activeSetPath,
    );
  } catch {
    return null;
  }
}

type LegacySave = Save & { snapshotPath?: string };

type SaveStorageSource =
  | { kind: 'manifest'; manifest: Manifest }
  | { kind: 'legacy-snapshot'; snapshotPath: string };

async function getSaveStorageSource(
  projectPath: string,
  save: Save,
): Promise<SaveStorageSource> {
  try {
    const manifest = await readManifest(projectPath, save.id);
    return { kind: 'manifest', manifest };
  } catch (err) {
    const legacySnapshotPath = (save as LegacySave).snapshotPath;
    if (legacySnapshotPath) {
      try {
        await access(legacySnapshotPath);
        return { kind: 'legacy-snapshot', snapshotPath: legacySnapshotPath };
      } catch {
        // fall through to friendly error below
      }
    }

    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      throw new AppError(
        'Restore data for this save is missing. This snapshot can no longer be restored.',
        410,
      );
    }
    throw err;
  }
}

async function getSaveAlsPath(
  projectPath: string,
  save: Save,
): Promise<string> {
  const source = await getSaveStorageSource(projectPath, save);
  if (source.kind === 'legacy-snapshot') {
    const legacyAlsPath = join(
      source.snapshotPath,
      save.metadata.activeSetPath,
    );
    try {
      await access(legacyAlsPath);
      return legacyAlsPath;
    } catch {
      throw new AppError('Saved .als file not found in legacy snapshot.', 404);
    }
  }

  const alsHash = findAlsHashInEntries(
    source.manifest.files,
    save.metadata.activeSetPath,
  );
  if (!alsHash)
    throw new AppError('Saved .als file not found in snapshot manifest.', 404);
  return getBlobPath(projectPath, alsHash);
}

// ── Async Mutex ─────────────────────────────────────────────────────

const MUTEX_TIMEOUT_MS = 30_000;

class AsyncMutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(timeoutMs = MUTEX_TIMEOUT_MS): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.indexOf(onRelease);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new AppError('State lock timeout — try again.', 503));
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

export class AblegitService {
  private readonly rootDir: string;
  private readonly statePath: string;
  private readonly mutex = new AsyncMutex();
  private readonly launcher: AbletonLauncher;
  private readonly ideaPathIndex = new Map<string, Map<string, string>>();

  constructor(
    rootDir = resolve(process.cwd(), '.ablegit-state'),
    launcher: AbletonLauncher = createAbletonLauncher(),
  ) {
    this.rootDir = rootDir;
    this.statePath = join(rootDir, 'state.json');
    this.launcher = launcher;
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

  private refreshPathIndexes(state: AppState): void {
    this.ideaPathIndex.clear();
    for (const project of state.projects) {
      this.refreshProjectPathIndex(project);
    }
  }

  private sortProjects(projects: Project[]): Project[] {
    return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private buildProjectRecord(input: {
    name?: string;
    projectPath: string;
    metadata: ProjectMetadata;
    rootIds?: string[];
  }): Project {
    const now = new Date().toISOString();

    // Create an idea for every .als file in the project
    const ideas: Idea[] = input.metadata.setFiles.map((setFile) => ({
      id: createId('idea'),
      name: basename(setFile, extname(setFile)),
      createdAt: now,
      setPath: setFile,
      baseSaveId: '',
      headSaveId: '',
      parentIdeaId: null,
      forkedFromSaveId: null,
    }));

    // The active .als becomes currentIdeaId
    const activeIdea =
      ideas.find((i) => i.setPath === input.metadata.activeSetPath) ??
      ideas[0]!;

    return {
      id: createId('proj'),
      name: input.name?.trim() || basename(input.projectPath),
      adapter: 'ableton',
      projectPath: input.projectPath,
      rootIds: input.rootIds ?? [],
      presence: 'active',
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
    await mkdir(this.rootDir, { recursive: true });
    try {
      const content = await readFile(this.statePath, 'utf8');
      const state = migrateState(JSON.parse(content) as AppState);
      this.refreshPathIndexes(state);
      return state;
    } catch {
      this.ideaPathIndex.clear();
      return { roots: [], projects: [], activity: [] };
    }
  }

  private async saveState(state: AppState): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const tmp = `${this.statePath}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(state, null, 2));
      await rename(tmp, this.statePath);
      this.refreshPathIndexes(state);
    } catch (err) {
      // Clean up partial temp file
      await rm(tmp, { force: true }).catch(() => {});
      if (err && typeof err === 'object' && 'code' in err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOSPC') {
          throw new AppError(
            'Disk is full — cannot save project state. Free up space and try again.',
            507,
          );
        }
      }
      throw err;
    }
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

  private async assertDir(p: string): Promise<void> {
    const s = await stat(p).catch(() => null);
    if (!s || !s.isDirectory())
      throw new AppError(`Directory not found: ${p}`, 404);
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
      const existing = state.projects.find(
        (p) => p.projectPath === projectPath,
      );
      if (existing) {
        if (input.rootIds?.length) {
          existing.rootIds = [
            ...new Set([...existing.rootIds, ...input.rootIds]),
          ].sort();
          existing.presence = 'active';
          existing.lastSeenAt = new Date().toISOString();
          await this.saveState(state);
        }
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
          err instanceof Error ? err.message : 'Could not scan this root.';
      }
    }

    const existingProjects = new Map(
      state.projects.map((project) => [project.projectPath, project]),
    );

    for (const project of state.projects) {
      const discovered = discoveredByPath.get(project.projectPath);
      const wasMissing = project.presence === 'missing';
      if (discovered) {
        project.rootIds = [...discovered.rootIds].sort();
        project.presence = 'active';
        project.lastSeenAt = now;
        if (!project.name.trim()) project.name = discovered.name;
        if (wasMissing) {
          pushActivity(
            state,
            createActivity(
              'project-restored',
              `${project.name} is available again.`,
              'success',
              { projectId: project.id },
            ),
          );
        }
        continue;
      }

      if (project.rootIds.length > 0) {
        project.rootIds = [];
        project.presence = 'missing';
        if (!wasMissing) {
          pushActivity(
            state,
            createActivity(
              'project-missing',
              `${project.name} is missing from its watched roots.`,
              'warning',
              { projectId: project.id },
            ),
          );
        }
      }
    }

    for (const [projectPath, discovered] of discoveredByPath) {
      if (existingProjects.has(projectPath)) continue;
      const snapshot = await walkProject(projectPath);
      const metadata = metadataFromFiles(snapshot.files);
      const project = this.buildProjectRecord({
        name: discovered.name,
        projectPath,
        metadata,
        rootIds: [...discovered.rootIds].sort(),
      });
      state.projects.push(project);
      pushActivity(
        state,
        createActivity(
          'project-discovered',
          `Now protecting ${project.name}.`,
          'success',
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
          id: createId('root'),
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
            'root-added',
            `Watching folder ${root.name}.`,
            'info',
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
      if (!root) throw new AppError('Root not found.', 404);
      state.roots = state.roots.filter((candidate) => candidate.id !== rootId);
      pushActivity(
        state,
        createActivity(
          'root-removed',
          `Stopped watching ${root.name}.`,
          'warning',
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
    input?: { label?: string; note?: string; auto?: boolean },
  ): Promise<{ project: Project; save: Save | null }> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const idea = requireIdea(project, project.currentIdeaId);
      return this.createSaveInState(state, project, idea, input);
    });
  }

  private baselineSaveForIdea(project: Project, idea: Idea): Save | null {
    const ideaSaves = project.saves.filter((save) => save.ideaId === idea.id);
    if (ideaSaves.length > 0) return ideaSaves.at(-1) ?? null;
    if (idea.forkedFromSaveId)
      return requireSave(project, idea.forkedFromSaveId);
    return null;
  }

  private setPendingOpen(
    project: Project,
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
    kind: DriftStatus['kind'],
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
    input?: { label?: string; note?: string; auto?: boolean },
    preferredSetPath?: string,
  ): Promise<{ project: Project; save: Save | null }> {
    const expectedSetPaths = uniqueStrings(
      [preferredSetPath, idea.setPath].filter(
        (value): value is string => Boolean(value && value.trim()),
      ),
    );
    const { snapshot, metadata: detectedMetadata } = await captureSettledSnapshot(
      project.projectPath,
      expectedSetPaths,
    );
    const projectHash = hashProject(snapshot);
    const saveBaseline = this.baselineSaveForIdea(project, idea);

    if (
      input?.auto &&
      saveBaseline &&
      matchesProjectHash(snapshot, saveBaseline.projectHash)
    ) {
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
    const saveId = createId('save');
    const entries: ManifestEntry[] = [];
    const baselineManifest = saveBaseline
      ? await readManifest(project.projectPath, saveBaseline.id).catch(() => null)
      : null;
    const baselineEntries = baselineManifest
      ? buildManifestFileIndex(baselineManifest.files)
      : null;

    for (const file of snapshot.files) {
      const reusable = baselineEntries?.get(file.relativePath);
      if (
        reusable &&
        reusable.size === file.size &&
        reusable.mtimeMs === file.mtimeMs
      ) {
        entries.push({
          relativePath: file.relativePath,
          blobHash: reusable.blobHash,
          size: reusable.size,
          mtimeMs: file.mtimeMs,
        });
        continue;
      }

      const abs = join(project.projectPath, file.relativePath);
      const { hash, size } = await storeBlob(project.projectPath, abs);
      entries.push({
        relativePath: file.relativePath,
        blobHash: hash,
        size,
        mtimeMs: file.mtimeMs,
      });
    }
    for (const relativePath of snapshot.emptyDirs) {
      entries.push({ type: 'dir', relativePath });
    }
    const now = new Date().toISOString();
    await createManifest(project.projectPath, saveId, entries, now);

    let changes: ChangeSummary | undefined;
    let setDiff: SetDiff | undefined;
    let trackSummary: TrackSummaryItem[] | undefined;
    const currAlsHash = findAlsHashInEntries(entries, metadata.activeSetPath);

    if (saveBaseline) {
      try {
        const prevManifest = await readManifest(
          project.projectPath,
          saveBaseline.id,
        );
        const diff = diffManifestEntries(prevManifest.files, entries);
        changes = {
          ...diff,
          sizeDelta: metadata.sizeBytes - saveBaseline.metadata.sizeBytes,
        };
      } catch {
        // manifest missing — skip changes
      }

      const prevAlsHash = await findPrevAlsHash(
        project.projectPath,
        saveBaseline,
      );
      if (prevAlsHash && currAlsHash) {
        const result = await tryComputeSetDiff(
          getBlobPath(project.projectPath, prevAlsHash),
          getBlobPath(project.projectPath, currAlsHash),
        );
        setDiff = result.diff;
        if (result.currSnapshot) {
          trackSummary = extractTrackSummary(result.currSnapshot);
        }
      }
    }

    if (!trackSummary && currAlsHash) {
      const parsed = await tryParseSnapshot(
        getBlobPath(project.projectPath, currAlsHash),
      );
      if (parsed) trackSummary = extractTrackSummary(parsed);
    }

    const save: Save = {
      id: saveId,
      label:
        input?.label?.trim() ||
        (input?.auto ? formatDiffAsLabel(setDiff, changes) : autoLabel()),
      note: input?.note?.trim() || '',
      createdAt: now,
      ideaId: idea.id,
      previewRefs: [],
      projectHash,
      metadata,
      auto: input?.auto ?? false,
      changes,
      setDiff,
      trackSummary,
    };
    project.saves.push(save);
    idea.headSaveId = save.id;
    if (!idea.baseSaveId) idea.baseSaveId = save.id;
    idea.setPath = resolvedSetPath;
    project.pendingOpen =
      project.pendingOpen?.ideaId === idea.id ? null : project.pendingOpen;
    project.driftStatus = null;
    project.updatedAt = now;
    project.presence = 'active';
    project.lastSeenAt = now;
    project.watchError = null;

    if (save.auto) {
      pushActivity(
        state,
        createActivity(
          'auto-saved',
          `Saved ${project.name}: ${save.label}`,
          'success',
          { projectId: project.id },
        ),
      );
    }

    try {
      await this.saveState(state);
    } catch (err) {
      await deleteManifest(project.projectPath, saveId);
      throw err;
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
        'missing-file',
      );
      project.pendingOpen = null;
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);
      return { project, openError: 'Branch file is missing on disk.' };
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
        err instanceof Error ? err.message : 'Failed to open branch file.';
      project.pendingOpen = this.setPendingOpen(project, idea, message);
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);
      return { project, openError: message };
    }
  }

  async branchFromSave(
    projectId: string,
    input: { saveId: string; name: string; fileName: string },
  ): Promise<{ project: Project; openError?: string }> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const save = requireSave(project, input.saveId);
      const branchName =
        input.name.trim() || buildRecoveredIdeaName(project, save);
      const requestedFileName =
        input.fileName.trim() || buildDefaultBranchFileName(save.label);
      const setPath = await buildUniqueBranchSetPath({
        projectPath: project.projectPath,
        baseDir: dirnameOfSetPath(save.metadata.activeSetPath),
        requestedFileName,
      });
      const sourceAlsPath = await getSaveAlsPath(project.projectPath, save);
      const absoluteSetPath = resolveProjectFilePath(
        project.projectPath,
        setPath,
      );
      await mkdir(
        dirnameOfSetPath(setPath)
          ? join(project.projectPath, dirnameOfSetPath(setPath))
          : project.projectPath,
        {
          recursive: true,
        },
      );
      await copyFile(sourceAlsPath, absoluteSetPath);

      const idea = createBranchIdea(project, save, branchName, setPath);
      project.ideas.push(idea);
      project.updatedAt = new Date().toISOString();

      try {
        const result = await this.openIdeaInState(state, project, idea);
        return result;
      } catch (err) {
        await rm(absoluteSetPath, { force: true }).catch(() => {});
        project.ideas = project.ideas.filter(
          (candidate) => candidate.id !== idea.id,
        );
        throw err;
      }
    });
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
          err instanceof Error ? err.message : 'Failed to reveal branch file.';
        project.driftStatus = this.setDriftStatus(
          idea.setPath,
          idea.id,
          'missing-file',
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
      if (!drift || drift.kind !== 'unknown-file') {
        throw new AppError('No drifted Ableton file to adopt.', 409);
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
        throw new AppError('No changed Ableton file was provided.', 400);
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
          id: createId('idea'),
          name: ensureUniqueIdeaName(project, ideaName),
          createdAt: now,
          setPath: preferredCandidate.relativeSetPath,
          baseSaveId: '',
          headSaveId: '',
          parentIdeaId: null,
          forkedFromSaveId: null,
        };
        project.ideas.push(newIdea);
        resolvedIdeaId = newIdea.id;
        stateChanged = true;
      }

      if (project.currentIdeaId !== resolvedIdeaId) {
        project.currentIdeaId = resolvedIdeaId;
        stateChanged = true;
      }
      if (project.presence !== 'active') {
        project.presence = 'active';
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

  async listSmartRestoreTracks(
    projectId: string,
    saveId: string,
  ): Promise<SmartRestoreTrack[]> {
    const state = await this.loadState();
    const project = requireProject(state, projectId);
    const save = requireSave(project, saveId);
    const alsPath = await getSaveAlsPath(project.projectPath, save);
    return listRestorableTracks(alsPath);
  }

  async smartRestore(
    projectId: string,
    saveId: string,
    trackIds: string[],
  ): Promise<SmartRestoreResult> {
    if (trackIds.length === 0) {
      throw new AppError('Select at least one track to restore.');
    }

    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const save = requireSave(project, saveId);
      const sourceAlsPath = await getSaveAlsPath(project.projectPath, save);
      const currentIdea = requireIdea(project, project.currentIdeaId);
      const targetAlsPath = resolveProjectFilePath(
        project.projectPath,
        currentIdea.setPath,
      );

      return smartRestoreTracks({
        sourceAlsPath,
        targetAlsPath,
        selectedTrackIds: trackIds,
      });
    });
  }

  async updateSave(
    projectId: string,
    saveId: string,
    input: { note?: string; label?: string },
  ): Promise<Project> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const save = requireSave(project, saveId);
      if (input.note !== undefined) save.note = input.note;
      if (input.label !== undefined) save.label = input.label;
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
      if (watching) project.watchError = null;
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
          'watcher-error',
          `${project.name}: ${message}`,
          'error',
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
      if (!project.watchError) return project;
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
      requireSave(project, saveId);
      if (project.ideas.some((idea) => idea.forkedFromSaveId === saveId)) {
        throw new AppError(
          'Cannot delete a save that other branches fork from.',
          409,
        );
      }
      await deleteManifest(project.projectPath, saveId);
      project.saves = project.saves.filter((s) => s.id !== saveId);
      for (const idea of project.ideas) {
        if (idea.headSaveId === saveId) {
          const ideaSaves = project.saves.filter((s) => s.ideaId === idea.id);
          idea.headSaveId = ideaSaves.at(-1)?.id ?? '';
        }
        if (idea.baseSaveId === saveId) idea.baseSaveId = idea.headSaveId;
      }
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);
      // GC unreferenced blobs
      const keepIds = project.saves.map((s) => s.id);
      await gcBlobs(project.projectPath, keepIds);
      return project;
    });
  }

  async resolvePreviewPath(p: string): Promise<string> {
    const resolved = resolve(p);
    const state = await this.loadState();
    const allowedPreviewPaths = new Set(
      state.projects.flatMap((project) =>
        project.saves.flatMap((save) =>
          save.previewRefs.map((previewRef) => resolve(previewRef)),
        ),
      ),
    );
    if (!allowedPreviewPaths.has(resolved)) {
      throw new AppError('File not found', 404);
    }
    await access(resolved);
    return resolved;
  }

  /** Compute changes for a save that doesn't have them yet (backfill). */
  async computeChanges(
    projectId: string,
    saveId: string,
  ): Promise<{ project: Project; changes: ChangeSummary | null }> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const save = requireSave(project, saveId);

      if (save.changes && save.setDiff !== undefined)
        return { project, changes: save.changes };

      const ideaSaves = project.saves.filter((s) => s.ideaId === save.ideaId);
      const idx = ideaSaves.findIndex((s) => s.id === saveId);
      const prevSave = idx > 0 ? ideaSaves[idx - 1] : null;

      if (!prevSave) return { project, changes: null };

      let dirty = false;

      if (!save.changes) {
        try {
          const [prevManifest, currManifest] = await Promise.all([
            readManifest(project.projectPath, prevSave.id),
            readManifest(project.projectPath, save.id),
          ]);
          const diff = diffManifestEntries(
            prevManifest.files,
            currManifest.files,
          );
          save.changes = {
            ...diff,
            sizeDelta: save.metadata.sizeBytes - prevSave.metadata.sizeBytes,
          };
          dirty = true;
        } catch {
          return { project, changes: null };
        }
      }

      if (save.setDiff === undefined) {
        const prevAlsHash = await findPrevAlsHash(
          project.projectPath,
          prevSave,
        );
        const currAlsHash = await findPrevAlsHash(project.projectPath, save);
        if (prevAlsHash && currAlsHash) {
          const result = await tryComputeSetDiff(
            getBlobPath(project.projectPath, prevAlsHash),
            getBlobPath(project.projectPath, currAlsHash),
          );
          if (result.diff) {
            save.setDiff = result.diff;
            dirty = true;
          }
          if (!save.trackSummary && result.currSnapshot) {
            save.trackSummary = extractTrackSummary(result.currSnapshot);
            dirty = true;
          }
        }
      }

      if (dirty) await this.saveState(state);
      return { project, changes: save.changes ?? null };
    });
  }

  /** Get disk usage statistics for a project. */
  async getDiskUsage(projectId: string): Promise<DiskUsage> {
    const state = await this.loadState();
    const project = requireProject(state, projectId);

    // Scan blobs directory for actual disk usage
    const blobsDirPath = join(project.projectPath, '.ablegit-state', 'blobs');
    let blobStorageBytes = 0;
    let blobCount = 0;
    try {
      const entries = await readdir(blobsDirPath);
      for (const name of entries) {
        if (name.endsWith('.tmp')) continue;
        const s = await stat(join(blobsDirPath, name)).catch(() => null);
        if (s) {
          blobStorageBytes += s.size;
          blobCount++;
        }
      }
    } catch {
      // blobs dir doesn't exist yet
    }

    // Count manifests
    const manifestsDirPath = join(
      project.projectPath,
      '.ablegit-state',
      'manifests',
    );
    let manifestCount = 0;
    try {
      const entries = await readdir(manifestsDirPath);
      manifestCount = entries.filter((e) => e.endsWith('.json')).length;
    } catch {
      // manifests dir doesn't exist yet
    }

    const autoSaves = project.saves.filter((s) => s.auto);
    const manualSaves = project.saves.filter((s) => !s.auto);
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
      saves: project.saves.map((s) => ({
        id: s.id,
        label: s.label,
        createdAt: s.createdAt,
        snapshotBytes: s.metadata.sizeBytes,
        auto: s.auto,
      })),
    };
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
      const headSaveIds = new Set(project.ideas.map((i) => i.headSaveId));
      const baseSaveIds = new Set(project.ideas.map((i) => i.baseSaveId));
      const forkSaveIds = new Set(
        project.ideas
          .map((i) => i.forkedFromSaveId)
          .filter((id): id is string => Boolean(id)),
      );
      const toDelete = project.saves.filter(
        (s) =>
          s.auto &&
          s.createdAt < cutoffIso &&
          !headSaveIds.has(s.id) &&
          !baseSaveIds.has(s.id) &&
          !forkSaveIds.has(s.id),
      );

      if (toDelete.length === 0) return { project, deletedCount: 0 };

      // Delete manifests
      for (const s of toDelete) {
        await deleteManifest(project.projectPath, s.id);
      }

      const deleteIds = new Set(toDelete.map((s) => s.id));
      project.saves = project.saves.filter((s) => !deleteIds.has(s.id));
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);

      // GC unreferenced blobs
      const keepIds = project.saves.map((s) => s.id);
      await gcBlobs(project.projectPath, keepIds);

      return { project, deletedCount: toDelete.length };
    });
  }
}
