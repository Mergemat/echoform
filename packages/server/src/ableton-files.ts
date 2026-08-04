import { isAbsolute, relative, resolve, sep } from "node:path";

export interface AbletonLauncher {
  openFile: (filePath: string) => Promise<void>;
  revealFile: (filePath: string) => Promise<void>;
}

async function runCommand(command: string, args: string[]): Promise<void> {
  const subprocess = Bun.spawn([command, ...args], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await subprocess.exited;
  if (exitCode === 0) {
    return;
  }
  const output = await new Response(subprocess.stderr).text();
  throw new Error(output.trim() || "Failed to open file.");
}

export function createAbletonLauncher(): AbletonLauncher {
  if (process.platform === "win32") {
    return {
      openFile(filePath) {
        return runCommand("cmd", ["/c", "start", "", filePath]);
      },
      revealFile(filePath) {
        return runCommand("explorer", ["/select,", filePath]);
      },
    };
  }

  return {
    openFile(filePath) {
      return runCommand("open", [filePath]);
    },
    revealFile(filePath) {
      return runCommand("open", ["-R", filePath]);
    },
  };
}

function normalizeCase(path: string): string {
  return process.platform === "win32" || process.platform === "darwin"
    ? path.toLowerCase()
    : path;
}

export function normalizeAbsolutePath(path: string): string {
  return normalizeCase(resolve(path));
}

export function normalizeRelativeSetPath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function resolveProjectFilePath(
  projectPath: string,
  relativePath: string,
): string {
  const root = resolve(projectPath);
  const resolved = resolve(root, relativePath);
  const rel = relative(root, resolved);
  if (isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === "..") {
    throw new Error("Project file path escapes the project directory.");
  }
  return resolved;
}

export function buildAbsolutePathIndex(
  projectPath: string,
  setPaths: Array<{ ideaId: string; setPath: string }>,
): Map<string, string> {
  return new Map(
    setPaths.map(({ ideaId, setPath }) => [
      normalizeAbsolutePath(resolveProjectFilePath(projectPath, setPath)),
      ideaId,
    ]),
  );
}

export function changePathToRelativeSetPath(
  projectPath: string,
  changedPath: string,
): string {
  const absolute = isAbsolute(changedPath)
    ? changedPath
    : resolve(projectPath, changedPath);
  const rel = relative(resolve(projectPath), absolute);
  if (isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === "..") {
    throw new Error("Changed Ableton file is outside the tracked project.");
  }
  return normalizeRelativeSetPath(rel);
}
