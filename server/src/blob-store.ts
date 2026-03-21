/**
 * blob-store.ts – Content-addressed blob storage for Ablegit snapshots.
 *
 * Blobs are stored per-project at {projectPath}/.ablegit-state/blobs/{sha256}.
 * Manifests map saveIds to their file→blob associations at
 * {projectPath}/.ablegit-state/manifests/{saveId}.json.
 *
 * All writes are atomic (write to .tmp, then rename).
 */

import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

// ── Types ───────────────────────────────────────────────────────────

export type ManifestEntry = {
  relativePath: string;
  blobHash: string;
  size: number;
};

export type Manifest = {
  saveId: string;
  files: ManifestEntry[];
  createdAt: string;
};

// ── Internal paths ──────────────────────────────────────────────────

function blobsDir(projectPath: string): string {
  return join(projectPath, '.ablegit-state', 'blobs');
}

function manifestsDir(projectPath: string): string {
  return join(projectPath, '.ablegit-state', 'manifests');
}

function blobFilePath(projectPath: string, hash: string): string {
  return join(blobsDir(projectPath), hash);
}

function manifestFilePath(projectPath: string, saveId: string): string {
  return join(manifestsDir(projectPath), `${saveId}.json`);
}

// ── Blob operations ─────────────────────────────────────────────────

/**
 * Store a file as a content-addressed blob.
 * Returns the SHA-256 hash and byte size.
 * If a blob with the same hash already exists, the write is skipped (dedup).
 */
export async function storeBlob(
  projectPath: string,
  filePath: string,
): Promise<{ hash: string; size: number }> {
  const content = await readFile(filePath);
  const hash = createHash('sha256').update(content).digest('hex');
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
      typeof err === 'object' &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOSPC'
    ) {
      throw new Error(
        'Disk is full — cannot store snapshot. Free up space and try again.',
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
  createdAt: string,
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
  saveId: string,
): Promise<Manifest> {
  const content = await readFile(manifestFilePath(projectPath, saveId), 'utf8');
  return JSON.parse(content) as Manifest;
}

/** Delete a manifest file. No-op if already deleted. */
export async function deleteManifest(
  projectPath: string,
  saveId: string,
): Promise<void> {
  await rm(manifestFilePath(projectPath, saveId), { force: true });
}

// ── Restore ─────────────────────────────────────────────────────────

/** Reconstruct a directory from a manifest by copying blobs to their original relative paths. */
export async function reconstructFromManifest(
  projectPath: string,
  manifest: Manifest,
  targetDir: string,
): Promise<void> {
  for (const entry of manifest.files) {
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
  keepSaveIds: string[],
): Promise<number> {
  // Collect all hashes referenced by kept saves
  const referenced = new Set<string>();
  for (const saveId of keepSaveIds) {
    try {
      const manifest = await readManifest(projectPath, saveId);
      for (const entry of manifest.files) {
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
    if (name.endsWith('.tmp') || !referenced.has(name)) {
      await rm(join(dir, name), { force: true });
      deleted++;
    }
  }
  return deleted;
}
