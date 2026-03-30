import { createHash } from 'node:crypto';
import {
  access,
  cp,
  mkdir,
  copyFile,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import type {
  ActivityItem,
  AppState,
  ChangeSummary,
  CompareResult,
  DriftStatus,
  DiskUsage,
  Idea,
  PendingOpen,
  PreviewRequestResult,
  PreviewStatus,
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
  resolveProjectStateDir,
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
import {
  LEGACY_STATE_DIRNAME,
  LEGACY_STATE_DIR_ENV,
  STATE_DIRNAME,
  STATE_DIR_ENV,
} from './paths';

const AUDIO_EXTENSIONS = new Set([
  '.aif',
  '.aiff',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.wav',
]);

type FileRecord = {
  relativePath: string;
  size: number;
  mtimeMs: number;
  contentHash?: string;
};
type ProjectSnapshot = { files: FileRecord[]; emptyDirs: string[] };
const MAX_ACTIVITY_ITEMS = 80;
const WALK_CONCURRENCY = 32;
const ALS_HASH_CONCURRENCY = 4;
const SAVE_SETTLE_RETRY_MS = 200;
const SAVE_SETTLE_MAX_ATTEMPTS = 8;
const AUTO_COMPACT_MAX_AUTO_SAVES = 100;
const AUTO_COMPACT_MAX_BLOB_STORAGE_BYTES = 2 * 1024 * 1024 * 1024;
const PREVIEW_FILE_BASENAME = 'preview';
const PREVIEW_EXTENSIONS = ['.wav', '.aif', '.aiff', '.mp3', '.m4a'] as const;
const PREVIEW_EXTENSION_SET = new Set<string>(PREVIEW_EXTENSIONS);
const PREVIEW_MIME_BY_EXTENSION: Record<string, string> = {
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
};

function isAlsPath(path: string): boolean {
  return extname(path).toLowerCase() === '.als';
}

function isBackupRelativePath(path: string): boolean {
  return path.startsWith('Backup/') || path.startsWith('Backup\\');
}

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

function migrateSave(save: Save): Save {
  const previewRefs = Array.isArray(save.previewRefs)
    ? save.previewRefs.filter((ref): ref is string => Boolean(ref))
    : [];
  const previewMime =
    'previewMime' in save && typeof save.previewMime === 'string'
      ? save.previewMime
      : inferPreviewMime(previewRefs[0] ?? '');
  const requestedAt =
    'previewRequestedAt' in save ? (save.previewRequestedAt ?? null) : null;
  const updatedAt =
    'previewUpdatedAt' in save ? (save.previewUpdatedAt ?? null) : null;
  const previewStatus = derivePreviewStatus({
    previewRefs,
    previewStatus:
      'previewStatus' in save &&
      typeof save.previewStatus === 'string' &&
      ['none', 'pending', 'ready', 'missing', 'error'].includes(
        save.previewStatus,
      )
        ? save.previewStatus
        : previewRefs.length > 0
          ? 'ready'
          : 'none',
  });

  return {
    ...save,
    previewRefs,
    previewStatus,
    previewMime,
    previewRequestedAt: requestedAt,
    previewUpdatedAt: updatedAt,
  };
}

function migrateProject(project: Project): Project {
  const ideas = project.ideas.map((idea) => migrateIdea(project, idea));
  const saves = project.saves.map((save) => migrateSave(save));
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
    saves,
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

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  }

  const concurrency = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

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
          entry.name === LEGACY_STATE_DIRNAME ||
          entry.name === 'Backup'
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

async function enrichAlsContentHashes(
  rootPath: string,
  snapshot: ProjectSnapshot,
): Promise<ProjectSnapshot> {
  const alsFiles = snapshot.files.filter((file) => isAlsPath(file.relativePath));
  if (alsFiles.length === 0) return snapshot;

  const contentHashes = new Map<string, string>();
  const results = await mapWithConcurrency(
    alsFiles,
    ALS_HASH_CONCURRENCY,
    async (file) => {
      const content = await readFile(join(rootPath, file.relativePath));
      return {
        relativePath: file.relativePath,
        contentHash: createHash('sha256').update(content).digest('hex'),
      };
    },
  );

  for (const result of results) {
    contentHashes.set(result.relativePath, result.contentHash);
  }

  return {
    emptyDirs: snapshot.emptyDirs,
    files: snapshot.files.map((file) =>
      contentHashes.has(file.relativePath)
        ? {
            ...file,
            contentHash: contentHashes.get(file.relativePath),
          }
        : file,
    ),
  };
}

function hashFiles(files: FileRecord[]): string {
  const h = createHash('sha256');
  for (const f of files) {
    h.update(`file:${f.relativePath}:${f.size}:`);
    if (isAlsPath(f.relativePath) && f.contentHash) {
      h.update(`content:${f.contentHash}`);
    } else {
      h.update(`mtime:${f.mtimeMs}`);
    }
    h.update('\n');
  }
  return h.digest('hex');
}

function hashProject(snapshot: ProjectSnapshot): string {
  const h = createHash('sha256');
  for (const f of snapshot.files) {
    h.update(`file:${f.relativePath}:${f.size}:`);
    if (isAlsPath(f.relativePath) && f.contentHash) {
      h.update(`content:${f.contentHash}`);
    } else {
      h.update(`mtime:${f.mtimeMs}`);
    }
    h.update('\n');
  }
  for (const dir of snapshot.emptyDirs) h.update(`dir:${dir}\n`);
  return h.digest('hex');
}

function hashFilesLegacy(files: FileRecord[]): string {
  const h = createHash('sha256');
  for (const f of files) h.update(`${f.relativePath}:${f.size}:${f.mtimeMs}\n`);
  return h.digest('hex');
}

function hashProjectLegacy(snapshot: ProjectSnapshot): string {
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
    hashFiles(snapshot.files) === expectedHash ||
    hashProjectLegacy(snapshot) === expectedHash ||
    hashFilesLegacy(snapshot.files) === expectedHash
  );
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
): Array<
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
    } => entry.type !== 'dir',
  );
}

function buildManifestFileIndex(
  entries: ManifestEntry[],
): Map<
  string,
  ManifestEntry & {
    blobHash: string;
    size: number;
    mtimeMs?: number;
    contentHash?: string;
  }
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
    isAlsPath(p) || isBackupRelativePath(p);
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

function slugifyProjectName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

function inferPreviewMime(previewPath: string): string | null {
  return PREVIEW_MIME_BY_EXTENSION[extname(previewPath).toLowerCase()] ?? null;
}

function derivePreviewStatus(
  save: Pick<Save, 'previewRefs' | 'previewStatus'>,
): PreviewStatus {
  if (
    save.previewStatus === 'pending' ||
    save.previewStatus === 'error' ||
    save.previewStatus === 'missing'
  ) {
    return save.previewStatus;
  }
  return save.previewRefs.length > 0 ? 'ready' : 'none';
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
  for (let attempt = 0; attempt < SAVE_SETTLE_MAX_ATTEMPTS; attempt++) {
    const walked = await walkProject(projectPath);
    const snapshot = await enrichAlsContentHashes(projectPath, walked);
    const metadata = metadataFromFiles(snapshot.files, expectedSetPaths[0]);

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

async function getBlobStorageStats(projectPath: string): Promise<{
  blobStorageBytes: number;
  blobCount: number;
}> {
  const blobsDirPath = join(resolveProjectStateDir(projectPath), 'blobs');
  let blobStorageBytes = 0;
  let blobCount = 0;
  try {
    const entries = await readdir(blobsDirPath);
    for (const name of entries) {
      if (name.endsWith('.tmp')) continue;
      const s = await stat(join(blobsDirPath, name)).catch(() => null);
      if (!s) continue;
      blobStorageBytes += s.size;
      blobCount++;
    }
  } catch {
    // blobs dir doesn't exist yet
  }
  return { blobStorageBytes, blobCount };
}

function compactRetentionBucketKey(
  createdAt: string,
  now: Date,
): string | null {
  const created = new Date(createdAt);
  const ageMs = now.getTime() - created.getTime();
  if (ageMs < 0) return `future:${createdAt}`;

  const dayMs = 24 * 60 * 60 * 1000;
  if (ageMs <= dayMs) return null;
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
    ...project.ideas
      .map((idea) => idea.forkedFromSaveId)
      .filter((id): id is string => Boolean(id)),
  ]);
}

function computeAutoSavesToCompact(
  project: Project,
  now = new Date(),
): Save[] {
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

async function findAlsHashForSave(
  projectPath: string,
  saveId: string,
  activeSetPath: string,
): Promise<string | null> {
  try {
    const manifest = await readManifest(projectPath, saveId);
    return findAlsHashInEntries(manifest.files, activeSetPath);
  } catch {
    return null;
  }
}

async function computeManifestChangeSummary(
  projectPath: string,
  prevSave: Save,
  currSaveId: string,
  currMetadata: ProjectMetadata,
): Promise<ChangeSummary | undefined> {
  try {
    const [prevManifest, currManifest] = await Promise.all([
      readManifest(projectPath, prevSave.id),
      readManifest(projectPath, currSaveId),
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

async function computeSemanticSaveData(
  projectPath: string,
  prevSave: Save | null,
  save: Pick<Save, 'id' | 'metadata'>,
): Promise<{
  setDiff: SetDiff | undefined;
  trackSummary: TrackSummaryItem[] | undefined;
}> {
  const currAlsHash = await findAlsHashForSave(
    projectPath,
    save.id,
    save.metadata.activeSetPath,
  );

  if (prevSave) {
    const prevAlsHash = await findPrevAlsHash(projectPath, prevSave);
    if (prevAlsHash && currAlsHash) {
      const result = await tryComputeSetDiff(
        getBlobPath(projectPath, prevAlsHash),
        getBlobPath(projectPath, currAlsHash),
      );
      return {
        setDiff: result.diff,
        trackSummary: result.currSnapshot
          ? extractTrackSummary(result.currSnapshot)
          : undefined,
      };
    }
  }

  if (currAlsHash) {
    const parsed = await tryParseSnapshot(
      getBlobPath(projectPath, currAlsHash),
    );
    if (parsed) {
      return {
        setDiff: undefined,
        trackSummary: extractTrackSummary(parsed),
      };
    }
  }

  return { setDiff: undefined, trackSummary: undefined };
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

export class EchoformService {
  private readonly rootDir: string;
  private readonly statePath: string;
  private readonly allowLegacyMigration: boolean;
  private readonly mutex = new AsyncMutex();
  private readonly launcher: AbletonLauncher;
  private readonly ideaPathIndex = new Map<string, Map<string, string>>();
  private readonly previewPathIndex = new Map<
    string,
    { projectId: string; saveId: string }
  >();

  constructor(
    rootDir = resolve(process.cwd(), STATE_DIRNAME),
    launcher: AbletonLauncher = createAbletonLauncher(),
    allowLegacyMigration = Boolean(
      process.env[STATE_DIR_ENV] ?? process.env[LEGACY_STATE_DIR_ENV],
    ),
  ) {
    this.rootDir = rootDir;
    this.statePath = join(rootDir, 'state.json');
    this.allowLegacyMigration = allowLegacyMigration;
    this.launcher = launcher;
  }

  private async maybeMigrateLegacyState(): Promise<void> {
    if (!this.allowLegacyMigration) return;
    const targetExists = await access(this.statePath)
      .then(() => true)
      .catch(() => false);
    if (targetExists) return;

    const legacyCandidates = [
      process.env[LEGACY_STATE_DIR_ENV],
      join(process.cwd(), LEGACY_STATE_DIRNAME),
    ]
      .filter((candidate): candidate is string => Boolean(candidate))
      .map((candidate) => resolve(candidate))
      .filter((candidate, index, all) => all.indexOf(candidate) === index)
      .filter((candidate) => candidate !== this.rootDir);

    for (const legacyRootDir of legacyCandidates) {
      const legacyStatePath = join(legacyRootDir, 'state.json');
      const legacyExists = await access(legacyStatePath)
        .then(() => true)
        .catch(() => false);
      if (!legacyExists) continue;

      await mkdir(dirname(this.rootDir), { recursive: true });
      try {
        await cp(legacyRootDir, this.rootDir, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
        return;
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'EEXIST') return;
        }
        throw err;
      }
    }
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
    await this.maybeMigrateLegacyState();
    await mkdir(this.rootDir, { recursive: true });
    try {
      const content = await readFile(this.statePath, 'utf8');
      const state = migrateState(JSON.parse(content) as AppState);
      this.refreshPathIndexes(state);
      return state;
    } catch {
      this.ideaPathIndex.clear();
      this.previewPathIndex.clear();
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

  private async compactProjectAutoSavesInState(
    state: AppState,
    project: Project,
  ): Promise<number> {
    const toDelete = computeAutoSavesToCompact(project);
    if (toDelete.length === 0) return 0;

    for (const save of toDelete) {
      await this.clearManagedPreviewFiles(save.previewRefs);
      await deleteManifest(project.projectPath, save.id);
    }

    const deleteIds = new Set(toDelete.map((save) => save.id));
    project.saves = project.saves.filter((save) => !deleteIds.has(save.id));
    project.updatedAt = new Date().toISOString();
    await this.saveState(state);

    await gcBlobs(
      project.projectPath,
      project.saves.map((save) => save.id),
    );
    return toDelete.length;
  }

  private async shouldCompactProjectAutoSaves(
    project: Project,
  ): Promise<boolean> {
    const autoSaveCount = project.saves.filter((save) => save.auto).length;
    if (autoSaveCount > AUTO_COMPACT_MAX_AUTO_SAVES) return true;
    const { blobStorageBytes } = await getBlobStorageStats(project.projectPath);
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
      'Music',
      'Echoform Previews',
      slugifyProjectName(project.name),
      save.id,
    );
  }

  private managedPreviewRoot(): string {
    return join(this.rootDir, 'previews');
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
        if (!resolved.startsWith(managedRoot)) return;
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
        if (stem !== PREVIEW_FILE_BASENAME) return;
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
      if (save.previewStatus !== 'pending') {
        await this.clearExportPreviewCandidates(folderPath);
        await this.clearManagedPreviewFiles(save.previewRefs);
        this.resetSavePreviewState(save, 'pending', now);
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
      if (save.previewStatus !== 'pending') return;
      const now = new Date().toISOString();
      this.resetSavePreviewState(save, 'none', now);
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
        err instanceof Error ? err.message : 'Failed to reveal preview folder.',
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
        `Unsupported format. Accepted: ${PREVIEW_EXTENSIONS.join(', ')}`,
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
      save.previewStatus = 'ready';
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
          if (save.previewStatus !== 'pending') continue;

          const folderPath = this.previewExportDir(project, save);
          const files = await readdir(folderPath).catch(() => null);
          if (!files) continue;

          // Accept any audio file with a valid extension (not just "preview.*")
          const matchingFiles = files.filter((file) => {
            const extension = extname(file).toLowerCase();
            return PREVIEW_EXTENSION_SET.has(extension);
          });

          if (matchingFiles.length === 0) continue;

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
            matchedFile = withMtime[0]!.file;
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
          save.previewStatus = 'ready';
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
      [preferredSetPath, idea.setPath].filter((value): value is string =>
        Boolean(value && value.trim()),
      ),
    );
    const { snapshot, metadata: detectedMetadata } =
      await captureSettledSnapshot(project.projectPath, expectedSetPaths);
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
      ? await readManifest(project.projectPath, saveBaseline.id).catch(
          () => null,
        )
      : null;
    const baselineEntries = baselineManifest
      ? buildManifestFileIndex(baselineManifest.files)
      : null;

    for (const file of snapshot.files) {
      const reusable = baselineEntries?.get(file.relativePath);
      if (
        reusable &&
        reusable.size === file.size &&
        (isAlsPath(file.relativePath)
          ? reusable.contentHash === file.contentHash
          : reusable.mtimeMs === file.mtimeMs)
      ) {
        entries.push({
          relativePath: file.relativePath,
          blobHash: reusable.blobHash,
          size: reusable.size,
          mtimeMs: file.mtimeMs,
          contentHash: file.contentHash,
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
        contentHash: file.contentHash,
      });
    }
    for (const relativePath of snapshot.emptyDirs) {
      entries.push({ type: 'dir', relativePath });
    }
    const now = new Date().toISOString();
    await createManifest(project.projectPath, saveId, entries, now);

    const changes = saveBaseline
      ? await computeManifestChangeSummary(
          project.projectPath,
          saveBaseline,
          saveId,
          metadata,
        )
      : undefined;
    let setDiff: SetDiff | undefined;
    let trackSummary: TrackSummaryItem[] | undefined;
    if (!input?.auto) {
      const semanticData = await computeSemanticSaveData(
        project.projectPath,
        saveBaseline,
        {
          id: saveId,
          metadata,
        },
      );
      setDiff = semanticData.setDiff;
      trackSummary = semanticData.trackSummary;
    }

    const save: Save = {
      id: saveId,
      label:
        input?.label?.trim() ||
        (input?.auto ? formatDiffAsLabel(setDiff, changes) : autoLabel()),
      customLabel: Boolean(input?.label?.trim()),
      note: input?.note?.trim() || '',
      createdAt: now,
      ideaId: idea.id,
      previewRefs: [],
      previewStatus: 'none',
      previewMime: null,
      previewRequestedAt: null,
      previewUpdatedAt: null,
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
      if (input.label !== undefined) {
        const nextLabel = input.label.trim();
        save.label = nextLabel;
        save.customLabel = nextLabel.length > 0;
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
      const save = requireSave(project, saveId);
      if (project.ideas.some((idea) => idea.forkedFromSaveId === saveId)) {
        throw new AppError(
          'Cannot delete a save that other branches fork from.',
          409,
        );
      }
      await this.clearManagedPreviewFiles(save.previewRefs);
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
      if (!project || !save) return;
      if (
        !save.previewRefs.some(
          (previewRef) => resolve(previewRef) === previewPath,
        )
      ) {
        return;
      }
      const now = new Date().toISOString();
      this.resetSavePreviewState(save, 'missing', now);
      project.updatedAt = now;
      await this.saveState(state);
    });
  }

  async resolvePreviewPath(p: string): Promise<string> {
    const resolved = resolve(p);
    const previewOwner = this.previewPathIndex.get(resolved);
    if (!previewOwner) {
      throw new AppError('File not found', 404);
    }
    try {
      await access(resolved);
    } catch {
      await this.markPreviewMissing(
        previewOwner.projectId,
        previewOwner.saveId,
        resolved,
      );
      throw new AppError('File not found', 404);
    }
    return resolved;
  }

  /** Compute changes for a save that doesn't have them yet (backfill). */
  async computeChanges(
    projectId: string,
    saveId: string,
  ): Promise<{ project: Project; changes: ChangeSummary | null }> {
    const analysisTarget = await this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const save = requireSave(project, saveId);

      if (save.changes && save.setDiff !== undefined && save.trackSummary) {
        return {
          project,
          save,
          prevSave: null,
          missingChanges: false,
          missingSemantic: false,
        };
      }

      const ideaSaves = project.saves.filter((s) => s.ideaId === save.ideaId);
      const idx = ideaSaves.findIndex((s) => s.id === saveId);
      const prevSave = idx > 0 ? ideaSaves[idx - 1] : null;

      return {
        project,
        save,
        prevSave,
        missingChanges: !save.changes && Boolean(prevSave),
        missingSemantic: save.setDiff === undefined || !save.trackSummary,
      };
    });

    if (!analysisTarget.missingChanges && !analysisTarget.missingSemantic) {
      return {
        project: analysisTarget.project,
        changes: analysisTarget.save.changes ?? null,
      };
    }

    const computedChanges =
      analysisTarget.missingChanges && analysisTarget.prevSave
        ? await computeManifestChangeSummary(
            analysisTarget.project.projectPath,
            analysisTarget.prevSave,
            analysisTarget.save.id,
            analysisTarget.save.metadata,
          )
        : analysisTarget.save.changes;

    const semanticData = analysisTarget.missingSemantic
      ? await computeSemanticSaveData(
          analysisTarget.project.projectPath,
          analysisTarget.prevSave,
          analysisTarget.save,
        )
      : {
          setDiff: analysisTarget.save.setDiff,
          trackSummary: analysisTarget.save.trackSummary,
        };

    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const save = requireSave(project, saveId);
      let dirty = false;

      if (!save.changes && computedChanges) {
        save.changes = computedChanges;
        dirty = true;
      }
      if (save.setDiff === undefined && semanticData.setDiff !== undefined) {
        save.setDiff = semanticData.setDiff;
        dirty = true;
      }
      if (!save.trackSummary && semanticData.trackSummary) {
        save.trackSummary = semanticData.trackSummary;
        dirty = true;
      }

      if (dirty) await this.saveState(state);
      return { project, changes: save.changes ?? null };
    });
  }

  /** Get disk usage statistics for a project. */
  async getDiskUsage(projectId: string): Promise<DiskUsage> {
    const state = await this.loadState();
    const project = requireProject(state, projectId);
    const { blobStorageBytes, blobCount } = await getBlobStorageStats(
      project.projectPath,
    );

    // Count manifests
    const manifestsDirPath = join(
      resolveProjectStateDir(project.projectPath),
      'manifests',
    );
    let manifestCount = 0;
    try {
      const entries = await readdir(manifestsDirPath);
      manifestCount = entries.filter((e) => e.endsWith('.json')).length;
    } catch {
      // manifests dir doesn't exist yet
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
