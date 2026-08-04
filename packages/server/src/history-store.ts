import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { mapWithConcurrency } from "./async-utils";
import {
  createManifest,
  readManifest,
  reconstructFromManifest,
  storeBlobBytes,
  type ManifestEntry,
} from "./blob-store";
import { STATE_DIRNAME } from "./paths";
import type { ProjectMetadata, RecoveryResult } from "./types";

const CAPTURE_CONCURRENCY = 8;
const CAPTURE_MAX_ATTEMPTS = 4;
const CAPTURE_RETRY_MS = 50;
const AUDIO_EXTENSIONS = new Set([
  ".aif",
  ".aiff",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".wav",
]);

interface ScannedFile {
  mtimeMs: number;
  relativePath: string;
  size: number;
}

interface ProjectScan {
  emptyDirs: string[];
  files: ScannedFile[];
}

async function scanProject(
  projectPath: string,
  currentPath = projectPath,
): Promise<ProjectScan> {
  const dirEntries = await readdir(currentPath, { withFileTypes: true });
  const children = await mapWithConcurrency(
    dirEntries,
    CAPTURE_CONCURRENCY,
    async (entry): Promise<ProjectScan> => {
      const absolutePath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === STATE_DIRNAME ||
          (currentPath === projectPath && entry.name === "Backup")
        ) {
          return { emptyDirs: [], files: [] };
        }
        const child = await scanProject(projectPath, absolutePath);
        if (child.files.length === 0 && child.emptyDirs.length === 0) {
          return {
            emptyDirs: [relative(projectPath, absolutePath)],
            files: [],
          };
        }
        return child;
      }
      if (!entry.isFile()) {
        return { emptyDirs: [], files: [] };
      }
      const metadata = await stat(absolutePath);
      return {
        emptyDirs: [],
        files: [
          {
            relativePath: relative(projectPath, absolutePath),
            size: metadata.size,
            mtimeMs: metadata.mtimeMs,
          },
        ],
      };
    },
  );
  return {
    emptyDirs: children.flatMap((child) => child.emptyDirs).sort(),
    files: children
      .flatMap((child) => child.files)
      .sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
      ),
  };
}

function scanIdentity(scan: ProjectScan): string {
  const hash = createHash("sha256");
  for (const file of scan.files) {
    hash.update(`${file.relativePath}\0${file.size}\0${file.mtimeMs}\n`);
  }
  for (const directory of scan.emptyDirs) {
    hash.update(`dir\0${directory}\n`);
  }
  return hash.digest("hex");
}

function projectHash(entries: ManifestEntry[]): string {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  )) {
    hash.update(
      entry.type === "dir"
        ? `dir\0${entry.relativePath}\n`
        : `file\0${entry.relativePath}\0${entry.size}\0${entry.blobHash}\n`,
    );
  }
  return hash.digest("hex");
}

function metadataFromStoredEntries(
  entries: ManifestEntry[],
  preferredSetPaths: string[],
): ProjectMetadata {
  const files = entries.filter(
    (entry): entry is Exclude<ManifestEntry, { type: "dir" }> =>
      entry.type !== "dir",
  );
  const setFiles = files
    .filter((file) => extname(file.relativePath).toLowerCase() === ".als")
    .map((file) => file.relativePath)
    .sort();
  if (setFiles.length === 0) {
    throw new Error("No Ableton .als file found in the project folder.");
  }
  const activeSetPath =
    preferredSetPaths.find((setPath) => setFiles.includes(setPath)) ??
    [...files]
      .filter((file) => setFiles.includes(file.relativePath))
      .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))[0]?.relativePath ??
    setFiles[0]!;
  return {
    activeSetPath,
    setFiles,
    audioFiles: files.filter((file) =>
      AUDIO_EXTENSIONS.has(extname(file.relativePath).toLowerCase()),
    ).length,
    fileCount: files.length,
    sizeBytes: files.reduce((total, file) => total + file.size, 0),
    modifiedAt: new Date(
      files.reduce((latest, file) => Math.max(latest, file.mtimeMs ?? 0), 0) ||
        Date.now(),
    ).toISOString(),
  };
}

export interface StoredSnapshot {
  entries: ManifestEntry[];
  metadata: ProjectMetadata;
  projectHash: string;
}

export interface SnapshotCaptureHooks {
  afterFilesCaptured?: (attempt: number) => Promise<void>;
}

/** Capture one coherent project generation and derive all metadata from stored bytes. */
export async function captureStoredSnapshot(
  projectPath: string,
  historyDir: string,
  saveId: string,
  expectedSetPaths: string[],
  hooks: SnapshotCaptureHooks = {},
): Promise<StoredSnapshot> {
  for (let attempt = 0; attempt < CAPTURE_MAX_ATTEMPTS; attempt++) {
    const before = await scanProject(projectPath);
    let changedDuringRead = false;
    const fileEntries = await mapWithConcurrency(
      before.files,
      CAPTURE_CONCURRENCY,
      async (file): Promise<ManifestEntry> => {
        const absolutePath = join(projectPath, file.relativePath);
        const beforeRead = await stat(absolutePath);
        const bytes = await readFile(absolutePath);
        const afterRead = await stat(absolutePath);
        if (
          beforeRead.size !== file.size ||
          beforeRead.mtimeMs !== file.mtimeMs ||
          afterRead.size !== beforeRead.size ||
          afterRead.mtimeMs !== beforeRead.mtimeMs ||
          bytes.length !== afterRead.size
        ) {
          changedDuringRead = true;
        }
        const stored = await storeBlobBytes(historyDir, bytes);
        return {
          relativePath: file.relativePath,
          blobHash: stored.hash,
          contentHash: stored.hash,
          size: stored.size,
          mtimeMs: afterRead.mtimeMs,
        };
      },
    );
    await hooks.afterFilesCaptured?.(attempt);
    const after = await scanProject(projectPath);
    if (changedDuringRead || scanIdentity(before) !== scanIdentity(after)) {
      if (attempt < CAPTURE_MAX_ATTEMPTS - 1) {
        await Bun.sleep(CAPTURE_RETRY_MS);
        continue;
      }
      throw new Error(
        "Project changed throughout snapshot capture. No save was created; try again after file writes settle.",
      );
    }
    const entries: ManifestEntry[] = [
      ...fileEntries,
      ...after.emptyDirs.map((relativePath) => ({
        type: "dir" as const,
        relativePath,
      })),
    ];
    const metadata = metadataFromStoredEntries(entries, expectedSetPaths);
    if (
      expectedSetPaths.length > 0 &&
      !expectedSetPaths.some((setPath) => metadata.setFiles.includes(setPath))
    ) {
      throw new Error(
        `Expected Ableton set ${expectedSetPaths[0]} is not present.`,
      );
    }
    await createManifest(historyDir, saveId, entries, new Date().toISOString());
    return { entries, metadata, projectHash: projectHash(entries) };
  }
  throw new Error("Snapshot capture failed.");
}

function safeRecoveryName(projectName: string, saveId: string): string {
  const name = projectName
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${name || "project"}-${saveId}`;
}

async function recoveryTargetExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

/** Reconstruct an entire manifest in a new user-visible recovery directory. */
export async function recoverStoredSnapshot(input: {
  activeSetPath: string;
  historyDir: string;
  projectName: string;
  recoveryRoot: string;
  saveId: string;
}): Promise<Pick<RecoveryResult, "activeSetPath" | "recoveredPath">> {
  const manifest = await readManifest(input.historyDir, input.saveId);
  if (
    !manifest.files.some(
      (entry) =>
        entry.type !== "dir" && entry.relativePath === input.activeSetPath,
    )
  ) {
    throw new Error(
      "The saved active Ableton set is missing from its manifest.",
    );
  }
  await mkdir(input.recoveryRoot, { recursive: true });
  const baseName = safeRecoveryName(input.projectName, input.saveId);
  let targetPath = join(input.recoveryRoot, baseName);
  let suffix = 2;
  while (await recoveryTargetExists(targetPath)) {
    targetPath = join(input.recoveryRoot, `${baseName}-${suffix++}`);
  }
  const stagingPath = `${targetPath}.staging-${crypto.randomUUID()}`;
  try {
    await mkdir(stagingPath, { recursive: false });
    await reconstructFromManifest(input.historyDir, manifest, stagingPath);
    await rename(stagingPath, targetPath);
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return {
    recoveredPath: targetPath,
    activeSetPath: join(targetPath, input.activeSetPath),
  };
}
