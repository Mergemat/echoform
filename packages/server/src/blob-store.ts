/**
 * blob-store.ts – Content-addressed blob storage for Echoform snapshots.
 *
 * Blobs are stored in the app-owned per-project history directory.
 * Manifests map saveIds to file→blob associations under that same app-owned
 * history directory. Working-project folders contain no snapshot payloads.
 *
 * All writes are atomic (write to .tmp, then rename).
 */

import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { STATE_DIRNAME } from "./paths";

// ── Types ───────────────────────────────────────────────────────────

export interface FileManifestEntry {
  blobHash: string;
  contentHash?: string;
  mtimeMs?: number;
  relativePath: string;
  size: number;
  type?: "file";
}

export interface DirectoryManifestEntry {
  relativePath: string;
  type: "dir";
}

export type ManifestEntry = FileManifestEntry | DirectoryManifestEntry;

export interface Manifest {
  createdAt: string;
  files: ManifestEntry[];
  saveId: string;
}

// ── Internal paths ──────────────────────────────────────────────────

export function resolveProjectStateDir(projectPath: string): string {
  return join(projectPath, STATE_DIRNAME);
}

function blobsDir(historyDir: string): string {
  return join(historyDir, "blobs");
}

function manifestsDir(historyDir: string): string {
  return join(historyDir, "manifests");
}

function blobFilePath(historyDir: string, hash: string): string {
  return join(blobsDir(historyDir), hash);
}

function manifestFilePath(historyDir: string, saveId: string): string {
  return join(manifestsDir(historyDir), `${saveId}.json`);
}

function trashDir(historyDir: string): string {
  return join(historyDir, "trash");
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

// ── Blob operations ─────────────────────────────────────────────────

/** Store already-captured bytes without rereading a mutable source file. */
export async function storeBlobBytes(
  historyDir: string,
  content: Uint8Array,
): Promise<{ hash: string; size: number }> {
  const hash = createHash("sha256").update(content).digest("hex");
  const dest = blobFilePath(historyDir, hash);

  const hasValidDestination = async (): Promise<boolean> => {
    try {
      const existing = await readFile(dest);
      return (
        existing.length === content.length &&
        createHash("sha256").update(existing).digest("hex") === hash
      );
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return false;
      }
      throw error;
    }
  };

  // Never trust a content-addressed filename without validating its bytes.
  if (await hasValidDestination()) {
    return { hash, size: content.length };
  }

  await mkdir(blobsDir(historyDir), { recursive: true });
  const tmp = `${dest}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, { flush: true });
    if (await hasValidDestination()) {
      await rm(tmp, { force: true });
      return { hash, size: content.length };
    }
    try {
      await rename(tmp, dest);
    } catch (promotionError) {
      if (await hasValidDestination()) {
        await rm(tmp, { force: true });
        return { hash, size: content.length };
      }
      const quarantine = `${dest}.corrupt-${crypto.randomUUID()}`;
      try {
        await rename(dest, quarantine);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) {
          throw promotionError;
        }
      }
      try {
        await rename(tmp, dest);
      } finally {
        await rm(quarantine, { force: true }).catch(() => {});
      }
    }
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOSPC"
    ) {
      throw new Error(
        "Disk is full — cannot store snapshot. Free up space and try again.",
      );
    }
    throw err;
  }
  return { hash, size: content.length };
}

/** Resolve the filesystem path to a stored blob by its hash. */
export function getBlobPath(historyDir: string, hash: string): string {
  return blobFilePath(historyDir, hash);
}

// ── Manifest operations ─────────────────────────────────────────────

/** Write a manifest for a save (atomic: .tmp → rename). */
export async function createManifest(
  historyDir: string,
  saveId: string,
  files: ManifestEntry[],
  createdAt: string,
): Promise<Manifest> {
  const manifest = validateManifest({ saveId, files, createdAt }, saveId);
  await mkdir(manifestsDir(historyDir), { recursive: true });
  const dest = manifestFilePath(historyDir, saveId);
  const tmp = `${dest}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(manifest, null, 2), { flush: true });
    await rename(tmp, dest);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  return manifest;
}

/** Read and parse a manifest for a save. Throws if not found. */
export async function readManifest(
  historyDir: string,
  saveId: string,
): Promise<Manifest> {
  const content = await readFile(manifestFilePath(historyDir, saveId), "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Manifest ${saveId} is corrupt.`, { cause: error });
  }
  return validateManifest(parsed, saveId);
}

function isSafeRelativePath(path: string): boolean {
  if (!path || isAbsolute(path)) {
    return false;
  }
  const normalized = normalize(path);
  return normalized !== ".." && !normalized.startsWith(`..${sep}`);
}

function validateManifest(value: unknown, expectedSaveId: string): Manifest {
  if (!(value && typeof value === "object" && !Array.isArray(value))) {
    throw new Error(`Manifest ${expectedSaveId} has an invalid structure.`);
  }
  const candidate = value as Partial<Manifest>;
  if (
    candidate.saveId !== expectedSaveId ||
    typeof candidate.createdAt !== "string" ||
    !Array.isArray(candidate.files)
  ) {
    throw new Error(`Manifest ${expectedSaveId} has an invalid structure.`);
  }
  const paths = new Set<string>();
  for (const entry of candidate.files) {
    if (!(entry && typeof entry === "object" && !Array.isArray(entry))) {
      throw new Error(`Manifest ${expectedSaveId} contains an invalid entry.`);
    }
    const item = entry as unknown as Record<string, unknown>;
    if (
      typeof item.relativePath !== "string" ||
      !isSafeRelativePath(item.relativePath)
    ) {
      throw new Error(`Manifest ${expectedSaveId} contains an unsafe path.`);
    }
    if (paths.has(item.relativePath)) {
      throw new Error(`Manifest ${expectedSaveId} contains duplicate paths.`);
    }
    paths.add(item.relativePath);
    if (
      item.type !== "dir" &&
      (typeof item.blobHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(item.blobHash) ||
        typeof item.size !== "number" ||
        !Number.isFinite(item.size) ||
        item.size < 0)
    ) {
      throw new Error(
        `Manifest ${expectedSaveId} contains an invalid file entry.`,
      );
    }
  }
  return candidate as Manifest;
}

/** Move manifests to recoverable trash. State references must be removed first. */
export async function stageManifestsForDeletion(
  historyDir: string,
  saveIds: string[],
): Promise<void> {
  if (saveIds.length === 0) {
    return;
  }
  const generation = `${Date.now()}-${crypto.randomUUID()}`;
  const destinationDir = join(trashDir(historyDir), generation, "manifests");
  await mkdir(destinationDir, { recursive: true });
  for (const saveId of saveIds) {
    const source = manifestFilePath(historyDir, saveId);
    const destination = join(destinationDir, `${saveId}.json`);
    try {
      await rename(source, destination);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }
}

// ── Restore ─────────────────────────────────────────────────────────

/** Reconstruct a directory from a manifest by copying blobs to their original relative paths. */
export async function reconstructFromManifest(
  historyDir: string,
  manifest: Manifest,
  targetDir: string,
): Promise<void> {
  for (const entry of manifest.files) {
    if (entry.type !== "dir") {
      continue;
    }
    await mkdir(join(targetDir, entry.relativePath), { recursive: true });
  }

  for (const entry of manifest.files) {
    if (entry.type === "dir") {
      continue;
    }
    const src = getBlobPath(historyDir, entry.blobHash);
    const dest = join(targetDir, entry.relativePath);
    const targetRoot = resolve(targetDir);
    const resolvedDestination = resolve(dest);
    if (
      resolvedDestination !== targetRoot &&
      !resolvedDestination.startsWith(`${targetRoot}${sep}`)
    ) {
      throw new Error(
        `Manifest path escapes the recovery directory: ${entry.relativePath}`,
      );
    }
    const bytes = await readFile(src);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== entry.blobHash || bytes.length !== entry.size) {
      throw new Error(`Blob verification failed for ${entry.relativePath}.`);
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }
}

// ── Garbage collection ──────────────────────────────────────────────

/**
 * Delete blobs not referenced by any of the given save IDs.
 * Also cleans up stale .tmp files from interrupted writes.
 * Returns the number of blobs deleted.
 */
export async function gcBlobs(
  historyDir: string,
  keepSaveIds: string[],
): Promise<number> {
  // Collect all hashes referenced by kept saves
  const referenced = new Set<string>();
  for (const saveId of keepSaveIds) {
    const manifest = await readManifest(historyDir, saveId);
    for (const entry of manifest.files) {
      if (entry.type === "dir") {
        continue;
      }
      referenced.add(entry.blobHash);
    }
  }

  // Stage any orphan manifest left by an interrupted destructive operation.
  try {
    const manifestNames = await readdir(manifestsDir(historyDir));
    const keepNames = new Set(keepSaveIds.map((saveId) => `${saveId}.json`));
    const orphanNames = manifestNames.filter(
      (name) => name.endsWith(".json") && !keepNames.has(name),
    );
    if (orphanNames.length > 0) {
      const destinationDir = join(
        trashDir(historyDir),
        `${Date.now()}-${crypto.randomUUID()}`,
        "manifests",
      );
      await mkdir(destinationDir, { recursive: true });
      for (const name of orphanNames) {
        await rename(
          join(manifestsDir(historyDir), name),
          join(destinationDir, name),
        );
      }
    }
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      throw error;
    }
  }

  // Scan blobs dir and delete unreferenced
  const dir = blobsDir(historyDir);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      throw error;
    }
    await rm(trashDir(historyDir), { recursive: true, force: true });
    return 0;
  }

  let deleted = 0;
  const unreferenced = entries.filter(
    (name) => !name.endsWith(".tmp") && !referenced.has(name),
  );
  if (unreferenced.length > 0) {
    const destinationDir = join(
      trashDir(historyDir),
      `${Date.now()}-${crypto.randomUUID()}`,
      "blobs",
    );
    await mkdir(destinationDir, { recursive: true });
    for (const name of unreferenced) {
      await rename(join(dir, name), join(destinationDir, name));
      deleted++;
    }
  }
  for (const name of entries.filter((entry) => entry.endsWith(".tmp"))) {
    await rm(join(dir, name), { force: true });
  }
  // Both current and previous app-state generations have already committed
  // before GC is called, so no recoverable state can refer to staged data.
  await rm(trashDir(historyDir), { recursive: true, force: true });
  return deleted;
}
