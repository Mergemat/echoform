/**
 * blob-store.ts – Content-addressed blob storage for Echoform snapshots.
 *
 * Blobs are stored per-project at {projectPath}/.echoform-state/blobs/{sha256}.
 * Manifests map saveIds to their file→blob associations at
 * {projectPath}/.echoform-state/manifests/{saveId}.json.
 *
 * All writes are atomic (write to .tmp, then rename).
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { LEGACY_STATE_DIRNAME, STATE_DIRNAME } from "./paths";

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
  const stateDir = join(projectPath, STATE_DIRNAME);
  if (existsSync(stateDir)) {
    return stateDir;
  }

  const legacyStateDir = join(projectPath, LEGACY_STATE_DIRNAME);
  if (existsSync(legacyStateDir)) {
    return legacyStateDir;
  }

  return stateDir;
}

function blobsDir(projectPath: string): string {
  return join(resolveProjectStateDir(projectPath), "blobs");
}

function manifestsDir(projectPath: string): string {
  return join(resolveProjectStateDir(projectPath), "manifests");
}

function blobFilePath(projectPath: string, hash: string): string {
  return join(blobsDir(projectPath), hash);
}

function manifestFilePath(projectPath: string, saveId: string): string {
  return join(manifestsDir(projectPath), `${saveId}.json`);
}

// ── Blob operations ─────────────────────────────────────────────────

const BLOB_STABILITY_POLL_MS = 100;
const BLOB_STABILITY_MAX_ATTEMPTS = 10;

/**
 * Wait until a file's size and mtime are stable across two consecutive polls.
 * This guards against reading a file that is still being written (e.g. a WAV
 * file Ableton is rendering). Throws if the file never settles within the
 * timeout window (BLOB_STABILITY_MAX_ATTEMPTS × BLOB_STABILITY_POLL_MS).
 */
async function waitForFileStability(filePath: string): Promise<void> {
  let prev = await stat(filePath);
  for (let attempt = 0; attempt < BLOB_STABILITY_MAX_ATTEMPTS; attempt++) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, BLOB_STABILITY_POLL_MS)
    );
    const next = await stat(filePath);
    if (next.size === prev.size && next.mtimeMs === prev.mtimeMs) {
      return;
    }
    prev = next;
  }
  throw new Error(
    `File is still being written and did not stabilise: ${filePath}. ` +
      `Try saving again after the render completes.`
  );
}

/**
 * Store a file as a content-addressed blob.
 * Returns the SHA-256 hash and byte size.
 * If a blob with the same hash already exists, the write is skipped (dedup).
 */
export async function storeBlob(
  projectPath: string,
  filePath: string
): Promise<{ hash: string; size: number }> {
  await waitForFileStability(filePath);
  const content = await readFile(filePath);
  const hash = createHash("sha256").update(content).digest("hex");
  const dest = blobFilePath(projectPath, hash);

  // Dedup: skip write if blob already exists
  try {
    await stat(dest);
    return { hash, size: content.length };
  } catch {
    // Blob doesn't exist yet — store it
  }

  await mkdir(blobsDir(projectPath), { recursive: true });
  const tmp = `${dest}.tmp`;
  try {
    await writeFile(tmp, content);
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOSPC"
    ) {
      throw new Error(
        "Disk is full — cannot store snapshot. Free up space and try again."
      );
    }
    throw err;
  }
  return { hash, size: content.length };
}

/** Resolve the filesystem path to a stored blob by its hash. */
export function getBlobPath(projectPath: string, hash: string): string {
  return blobFilePath(projectPath, hash);
}

// ── Manifest operations ─────────────────────────────────────────────

/** Write a manifest for a save (atomic: .tmp → rename). */
export async function createManifest(
  projectPath: string,
  saveId: string,
  files: ManifestEntry[],
  createdAt: string
): Promise<Manifest> {
  const manifest: Manifest = { saveId, files, createdAt };
  await mkdir(manifestsDir(projectPath), { recursive: true });
  const dest = manifestFilePath(projectPath, saveId);
  const tmp = `${dest}.tmp`;
  await writeFile(tmp, JSON.stringify(manifest, null, 2));
  await rename(tmp, dest);
  return manifest;
}

/** Read and parse a manifest for a save. Throws if not found. */
export async function readManifest(
  projectPath: string,
  saveId: string
): Promise<Manifest> {
  const content = await readFile(manifestFilePath(projectPath, saveId), "utf8");
  return JSON.parse(content) as Manifest;
}

/** Delete a manifest file. No-op if already deleted. */
export async function deleteManifest(
  projectPath: string,
  saveId: string
): Promise<void> {
  await rm(manifestFilePath(projectPath, saveId), { force: true });
}

// ── Restore ─────────────────────────────────────────────────────────

/** Reconstruct a directory from a manifest by copying blobs to their original relative paths. */
async function _reconstructFromManifest(
  projectPath: string,
  manifest: Manifest,
  targetDir: string
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
    const src = getBlobPath(projectPath, entry.blobHash);
    const dest = join(targetDir, entry.relativePath);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }
}

// ── Garbage collection ──────────────────────────────────────────────

/**
 * Delete blobs not referenced by any of the given save IDs.
 * Also cleans up stale .tmp files from interrupted writes.
 * Returns the number of blobs deleted.
 */
export async function gcBlobs(
  projectPath: string,
  keepSaveIds: string[]
): Promise<number> {
  // Collect all hashes referenced by kept saves
  const referenced = new Set<string>();
  for (const saveId of keepSaveIds) {
    try {
      const manifest = await readManifest(projectPath, saveId);
      for (const entry of manifest.files) {
        if (entry.type === "dir") {
          continue;
        }
        referenced.add(entry.blobHash);
      }
    } catch {
      // Manifest missing — its blobs won't be protected
    }
  }

  // Scan blobs dir and delete unreferenced
  const dir = blobsDir(projectPath);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0; // No blobs dir yet
  }

  let deleted = 0;
  for (const name of entries) {
    if (name.endsWith(".tmp") || !referenced.has(name)) {
      await rm(join(dir, name), { force: true });
      deleted++;
    }
  }
  return deleted;
}
