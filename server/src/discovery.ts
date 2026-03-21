import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { DiscoveredProject, Project } from "./types";

const COMMON_DIRS = [
  "Music/Ableton",
  "Documents/Ableton",
  "Library/Mobile Documents/com~apple~CloudDocs/ableton",
];

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function findAbletonProjects(dir: string): Promise<{ path: string; name: string; setFiles: string[] }[]> {
  const results: { path: string; name: string; setFiles: string[] }[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      try {
        const children = await readdir(fullPath);
        const alsFiles = children.filter((c) => extname(c).toLowerCase() === ".als");
        if (alsFiles.length > 0) {
          results.push({ path: fullPath, name: basename(fullPath), setFiles: alsFiles });
        }
      } catch {
        // skip unreadable dirs
      }
    }
  } catch {
    // skip
  }
  return results;
}

export async function discoverProjects(tracked: Project[]): Promise<DiscoveredProject[]> {
  const home = homedir();
  const trackedPaths = new Set(tracked.map((p) => p.projectPath));
  const all: DiscoveredProject[] = [];

  for (const rel of COMMON_DIRS) {
    const dir = resolve(home, rel);
    if (!(await dirExists(dir))) continue;
    // scan one level deeper too (for subdirectory organization)
    const topLevel = await findAbletonProjects(dir);
    all.push(...topLevel.map((p) => ({ ...p, tracked: trackedPaths.has(p.path) })));
    // check subdirs
    try {
      const subs = await readdir(dir, { withFileTypes: true });
      for (const sub of subs) {
        if (!sub.isDirectory() || sub.name.startsWith(".")) continue;
        const subDir = join(dir, sub.name);
        const subProjects = await findAbletonProjects(subDir);
        all.push(...subProjects.map((p) => ({ ...p, tracked: trackedPaths.has(p.path) })));
      }
    } catch {
      // skip
    }
  }

  // deduplicate by path
  const seen = new Set<string>();
  return all.filter((p) => {
    if (seen.has(p.path)) return false;
    seen.add(p.path);
    return true;
  });
}
