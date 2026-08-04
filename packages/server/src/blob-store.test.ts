import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManifest,
  gcBlobs,
  getBlobPath,
  storeBlobBytes,
} from "./blob-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("blob GC", () => {
  test("concurrent identical writes share one verified blob", async () => {
    const historyDir = await mkdtemp(join(tmpdir(), "echoform-blobs-"));
    roots.push(historyDir);
    const content = Buffer.from("identical-content");

    const stored = await Promise.all(
      Array.from({ length: 8 }, () => storeBlobBytes(historyDir, content)),
    );

    expect(new Set(stored.map((item) => item.hash)).size).toBe(1);
    expect(
      await readFile(getBlobPath(historyDir, stored[0]!.hash), "utf8"),
    ).toBe("identical-content");
  });

  test("replaces a corrupt blob found under the expected hash", async () => {
    const historyDir = await mkdtemp(join(tmpdir(), "echoform-blobs-"));
    roots.push(historyDir);
    const content = Buffer.from("trusted-content");
    const first = await storeBlobBytes(historyDir, content);
    await writeFile(getBlobPath(historyDir, first.hash), "corrupt");

    await storeBlobBytes(historyDir, content);

    expect(await readFile(getBlobPath(historyDir, first.hash), "utf8")).toBe(
      "trusted-content",
    );
  });

  test("aborts without deleting when a kept manifest is missing", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "echoform-gc-"));
    roots.push(projectPath);
    const blob = await storeBlobBytes(projectPath, Buffer.from("valuable"));

    await expect(gcBlobs(projectPath, ["missing-save"])).rejects.toThrow();
    await access(getBlobPath(projectPath, blob.hash));
  });

  test("aborts without deleting when a kept manifest is corrupt", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "echoform-gc-"));
    roots.push(projectPath);
    const blob = await storeBlobBytes(projectPath, Buffer.from("valuable"));
    await createManifest(
      projectPath,
      "kept",
      [{ relativePath: "song.als", blobHash: blob.hash, size: blob.size }],
      new Date().toISOString(),
    );
    await Bun.write(join(projectPath, "manifests", "kept.json"), "{corrupt");

    await expect(gcBlobs(projectPath, ["kept"])).rejects.toThrow("corrupt");
    await access(getBlobPath(projectPath, blob.hash));
  });

  test("finalizes staged trash after kept manifests validate", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "echoform-gc-"));
    roots.push(projectPath);
    const kept = await storeBlobBytes(projectPath, Buffer.from("kept"));
    const orphan = await storeBlobBytes(projectPath, Buffer.from("orphan"));
    await createManifest(
      projectPath,
      "kept",
      [{ relativePath: "song.als", blobHash: kept.hash, size: kept.size }],
      new Date().toISOString(),
    );

    expect(await gcBlobs(projectPath, ["kept"])).toBe(1);
    await access(getBlobPath(projectPath, kept.hash));
    await expect(
      access(getBlobPath(projectPath, orphan.hash)),
    ).rejects.toThrow();
    await expect(access(join(projectPath, "trash"))).rejects.toThrow();
  });
});
