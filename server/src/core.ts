import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import type {
  AppState,
  ChangeSummary,
  CompareResult,
  Idea,
  Project,
  ProjectMetadata,
  Save,
  SetDiff,
} from './types';
import type { ManifestEntry } from './blob-store';
import {
  createManifest,
  deleteManifest,
  gcBlobs,
  getBlobPath,
  readManifest,
  reconstructFromManifest,
  storeBlob,
} from './blob-store';
import { parseAlsFile } from './als-parser';
import { diffSets, isEmptyDiff } from './als-diff';
import { formatDiffAsLabel } from './smart-naming';

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

// ── Filesystem helpers ──────────────────────────────────────────────

async function walkProject(
  rootPath: string,
  currentPath = rootPath,
): Promise<FileRecord[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const results: FileRecord[] = [];
  for (const entry of entries) {
    const abs = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.ablegit-state') continue;
      results.push(...(await walkProject(rootPath, abs)));
      continue;
    }
    const s = await stat(abs);
    results.push({
      relativePath: relative(rootPath, abs),
      size: s.size,
      mtimeMs: s.mtimeMs,
    });
  }
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function hashFiles(files: FileRecord[]): string {
  const h = createHash('sha256');
  for (const f of files) h.update(`${f.relativePath}:${f.size}:${f.mtimeMs}\n`);
  return h.digest('hex');
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

/** Build a file-diff summary from two manifest entry lists. */
function diffManifestEntries(
  prev: ManifestEntry[],
  curr: ManifestEntry[],
): Omit<ChangeSummary, 'sizeDelta'> {
  const prevMap = new Map(prev.map((f) => [f.relativePath, f]));
  const currMap = new Map(curr.map((f) => [f.relativePath, f]));
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

/** Attempt to compute the semantic .als diff between two .als blob paths.
 *  Returns undefined on any failure — never throws. */
async function tryComputeSetDiff(
  prevAlsPath: string,
  currAlsPath: string,
): Promise<SetDiff | undefined> {
  try {
    const [prevSnapshot, currSnapshot] = await Promise.all([
      parseAlsFile(prevAlsPath),
      parseAlsFile(currAlsPath),
    ]);
    const diff = diffSets(prevSnapshot, currSnapshot);
    return isEmptyDiff(diff) ? undefined : diff;
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
    entries.find((e) => e.relativePath === activeSetPath)?.blobHash ?? null
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

  constructor(rootDir = resolve(process.cwd(), '.ablegit-state')) {
    this.rootDir = rootDir;
    this.statePath = join(rootDir, 'state.json');
  }

  async loadState(): Promise<AppState> {
    await mkdir(this.rootDir, { recursive: true });
    try {
      const content = await readFile(this.statePath, 'utf8');
      return JSON.parse(content) as AppState;
    } catch {
      return { projects: [] };
    }
  }

  private async saveState(state: AppState): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const tmp = `${this.statePath}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, this.statePath);
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
    return [...state.projects].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async trackProject(input: {
    name?: string;
    projectPath: string;
  }): Promise<Project> {
    return this.withLock(async () => {
      const projectPath = resolve(input.projectPath);
      const state = await this.loadState();
      const existing = state.projects.find(
        (p) => p.projectPath === projectPath,
      );
      if (existing) return existing;
      await this.assertDir(projectPath);
      const files = await walkProject(projectPath);
      const metadata = metadataFromFiles(files);
      const now = new Date().toISOString();
      const projectId = createId('proj');
      const firstIdeaId = createId('idea');
      const project: Project = {
        id: projectId,
        name: input.name?.trim() || basename(projectPath),
        adapter: 'ableton',
        projectPath,
        activeSetPath: metadata.activeSetPath,
        createdAt: now,
        updatedAt: now,
        currentIdeaId: firstIdeaId,
        lastRestoredSaveId: null,
        ideas: [
          {
            id: firstIdeaId,
            name: 'Main',
            createdAt: now,
            baseSaveId: '',
            headSaveId: '',
          },
        ],
        saves: [],
        watching: true,
      };
      state.projects.push(project);
      await this.saveState(state);
      return project;
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
      const currentFiles = await walkProject(project.projectPath);
      const projectHash = hashFiles(currentFiles);

      // Skip if nothing changed since last save (prevents watcher loops)
      const lastSave = project.saves.at(-1);
      if (input?.auto && lastSave && lastSave.projectHash === projectHash) {
        return { project, save: null };
      }

      const metadata = metadataFromFiles(currentFiles, project.activeSetPath);
      const saveId = createId('save');

      // Store files as content-addressed blobs + write manifest
      const entries: ManifestEntry[] = [];
      for (const file of currentFiles) {
        const abs = join(project.projectPath, file.relativePath);
        const { hash, size } = await storeBlob(project.projectPath, abs);
        entries.push({ relativePath: file.relativePath, blobHash: hash, size });
      }
      const now = new Date().toISOString();
      await createManifest(project.projectPath, saveId, entries, now);

      // Compute changes vs. previous save on the same idea
      const prevIdeaSaves = project.saves.filter((s) => s.ideaId === idea.id);
      const prevSave = prevIdeaSaves.at(-1);
      let changes: ChangeSummary | undefined;
      let setDiff: SetDiff | undefined;
      if (prevSave) {
        try {
          const prevManifest = await readManifest(
            project.projectPath,
            prevSave.id,
          );
          const diff = diffManifestEntries(prevManifest.files, entries);
          changes = {
            ...diff,
            sizeDelta: metadata.sizeBytes - prevSave.metadata.sizeBytes,
          };
        } catch {
          // manifest missing — skip changes
        }
        // Semantic .als diff via blob paths
        const prevAlsHash = await findPrevAlsHash(
          project.projectPath,
          prevSave,
        );
        const currAlsHash = findAlsHashInEntries(
          entries,
          metadata.activeSetPath,
        );
        if (prevAlsHash && currAlsHash) {
          setDiff = await tryComputeSetDiff(
            getBlobPath(project.projectPath, prevAlsHash),
            getBlobPath(project.projectPath, currAlsHash),
          );
        }
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
      };
      project.saves.push(save);
      idea.headSaveId = save.id;
      if (!idea.baseSaveId) idea.baseSaveId = save.id;
      project.updatedAt = now;
      project.activeSetPath = metadata.activeSetPath;
      try {
        await this.saveState(state);
      } catch (err) {
        await deleteManifest(project.projectPath, saveId);
        throw err;
      }
      return { project, save };
    });
  }

  async createIdea(
    projectId: string,
    input: { fromSaveId: string; name: string },
  ): Promise<Project> {
    return this.withLock(async () => {
      const name = input.name.trim();
      if (!name) throw new AppError('Idea name is required.');
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const fromSave = requireSave(project, input.fromSaveId);
      if (
        project.ideas.some((i) => i.name.toLowerCase() === name.toLowerCase())
      )
        throw new AppError('Idea name already exists.');
      const idea: Idea = {
        id: createId('idea'),
        name,
        createdAt: new Date().toISOString(),
        baseSaveId: fromSave.id,
        headSaveId: fromSave.id,
      };
      project.ideas.push(idea);
      project.currentIdeaId = idea.id;
      project.updatedAt = idea.createdAt;
      await this.saveState(state);
      return project;
    });
  }

  async goBackTo(
    projectId: string,
    input: { saveId: string; force?: boolean },
  ): Promise<Project> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      const save = requireSave(project, input.saveId);
      const manifest = await readManifest(project.projectPath, save.id);
      const currentHead = project.saves.find(
        (s) => s.id === requireIdea(project, project.currentIdeaId).headSaveId,
      );
      if (!input.force && currentHead) {
        const currentFiles = await walkProject(project.projectPath);
        const currentHash = hashFiles(currentFiles);
        if (currentHash !== currentHead.projectHash) {
          throw new AppError(
            'Project has unsaved changes on disk. Save first or force restore.',
            409,
          );
        }
      }
      // Stage-then-swap: reconstruct in temp dir, then atomic rename
      const backupPath = join(
        dirname(project.projectPath),
        `.ablegit-restore-${Date.now()}`,
      );
      const stagePath = join(
        dirname(project.projectPath),
        `.ablegit-stage-${Date.now()}`,
      );
      await rm(backupPath, { recursive: true, force: true });
      await rm(stagePath, { recursive: true, force: true });
      let renamedCurrent = false;
      try {
        await reconstructFromManifest(project.projectPath, manifest, stagePath);
        await rename(project.projectPath, backupPath);
        renamedCurrent = true;
        await rename(stagePath, project.projectPath);
        await rm(backupPath, { recursive: true, force: true });
      } catch (err) {
        if (renamedCurrent) {
          await rm(project.projectPath, { recursive: true, force: true });
          await rename(backupPath, project.projectPath);
        }
        await rm(stagePath, { recursive: true, force: true });
        throw err;
      }
      project.currentIdeaId = save.ideaId;
      project.lastRestoredSaveId = save.id;
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);
      return project;
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
      project.updatedAt = new Date().toISOString();
      await this.saveState(state);
      return project;
    });
  }

  async deleteSave(projectId: string, saveId: string): Promise<Project> {
    return this.withLock(async () => {
      const state = await this.loadState();
      const project = requireProject(state, projectId);
      requireSave(project, saveId);
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
          const setDiff = await tryComputeSetDiff(
            getBlobPath(project.projectPath, prevAlsHash),
            getBlobPath(project.projectPath, currAlsHash),
          );
          if (setDiff) {
            save.setDiff = setDiff;
            dirty = true;
          }
        }
      }

      if (dirty) await this.saveState(state);
      return { project, changes: save.changes ?? null };
    });
  }
}
