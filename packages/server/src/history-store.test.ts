import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBlobPath, readManifest } from "./blob-store";
import { captureStoredSnapshot, recoverStoredSnapshot } from "./history-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("snapshot capture", () => {
  test("retries the whole project when its generation drifts", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "echoform-capture-"));
    roots.push(projectPath);
    const setPath = join(projectPath, "song.als");
    const historyDir = `${projectPath}-history`;
    roots.push(historyDir);
    await writeFile(setPath, "before");

    let hookCalls = 0;
    const snapshot = await captureStoredSnapshot(
      projectPath,
      historyDir,
      "save-drift",
      ["song.als"],
      {
        afterFilesCaptured: async (attempt) => {
          hookCalls++;
          if (attempt === 0) {
            await writeFile(setPath, "after-generation");
          }
        },
      },
    );

    const manifest = await readManifest(historyDir, "save-drift");
    const entry = manifest.files.find((item) => item.type !== "dir");
    expect(hookCalls).toBe(2);
    expect(snapshot.metadata.sizeBytes).toBe("after-generation".length);
    expect(
      await readFile(getBlobPath(historyDir, entry!.blobHash), "utf8"),
    ).toBe("after-generation");
  });

  test("does not treat recovery target permission errors as availability", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "echoform-capture-"));
    const historyDir = `${projectPath}-history`;
    const recoveryRoot = `${projectPath}-recoveries`;
    roots.push(projectPath, historyDir, recoveryRoot);
    await writeFile(join(projectPath, "song.als"), "version");
    await captureStoredSnapshot(projectPath, historyDir, "save-permission", [
      "song.als",
    ]);
    await mkdir(recoveryRoot, { recursive: true });
    await chmod(recoveryRoot, 0);

    try {
      await expect(
        recoverStoredSnapshot({
          activeSetPath: "song.als",
          historyDir,
          projectName: "Permission",
          recoveryRoot,
          saveId: "save-permission",
        }),
      ).rejects.toThrow();
    } finally {
      await chmod(recoveryRoot, 0o755);
    }
  });
});
