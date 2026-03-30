import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type {
  DiscoveredProject,
  Project,
  RootSuggestion,
  TrackedRoot,
} from './types';
import { LEGACY_STATE_DIRNAME, STATE_DIRNAME } from './paths';

const COMMON_ROOT_DIRS = [
  'Music/Ableton',
  'Documents/Ableton',
  'Library/Mobile Documents/com~apple~CloudDocs/ableton',
  'Library/Mobile Documents/com~apple~CloudDocs/ableton/projects',
];

const IGNORED_DIRS = new Set([STATE_DIRNAME, LEGACY_STATE_DIRNAME, 'Backup']);

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function isIgnoredDir(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRS.has(name);
}

function isRealAlsFile(name: string): boolean {
  return !name.startsWith('._') && extname(name).toLowerCase() === '.als';
}

async function walkForProjects(
  rootPath: string,
  currentPath: string,
  results: Array<{ path: string; name: string; setFiles: string[] }>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentPath, {
      withFileTypes: true,
      encoding: 'utf8',
    });
  } catch {
    return;
  }

  const setFiles = entries
    .filter((entry) => entry.isFile() && isRealAlsFile(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (setFiles.length > 0) {
    results.push({
      path: currentPath,
      name: basename(currentPath),
      setFiles,
    });
    return;
  }

  const dirs = entries
    .filter((entry) => entry.isDirectory() && !isIgnoredDir(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  for (const dirName of dirs) {
    await walkForProjects(rootPath, join(currentPath, dirName), results);
  }
}

export async function discoverProjectsInRoot(
  rootPath: string,
): Promise<Array<{ path: string; name: string; setFiles: string[] }>> {
  const resolvedRoot = resolve(rootPath);
  if (!(await dirExists(resolvedRoot))) return [];
  const results: Array<{ path: string; name: string; setFiles: string[] }> = [];
  await walkForProjects(resolvedRoot, resolvedRoot, results);
  return results;
}

export async function discoverProjects(
  tracked: Project[],
  roots?: TrackedRoot[],
): Promise<DiscoveredProject[]> {
  const trackedPaths = new Set(tracked.map((project) => project.projectPath));
  const rootPaths =
    roots && roots.length > 0
      ? roots.map((root) => root.path)
      : (
          await discoverRootSuggestions()
        ).map((suggestion) => suggestion.path);

  const all: DiscoveredProject[] = [];
  for (const rootPath of rootPaths) {
    const projects = await discoverProjectsInRoot(rootPath);
    all.push(
      ...projects.map((project) => ({
        ...project,
        tracked: trackedPaths.has(project.path),
        rootPath,
      })),
    );
  }

  const seen = new Set<string>();
  return all.filter((project) => {
    if (seen.has(project.path)) return false;
    seen.add(project.path);
    return true;
  });
}

export async function discoverRootSuggestions(): Promise<RootSuggestion[]> {
  const suggestions: RootSuggestion[] = [];
  const seen = new Set<string>();

  for (const relativeDir of COMMON_ROOT_DIRS) {
    const path = resolve(homedir(), relativeDir);
    if (seen.has(path)) continue;
    seen.add(path);
    if (!(await dirExists(path))) continue;
    const projects = await discoverProjectsInRoot(path);
    if (projects.length === 0) continue;
    suggestions.push({
      path,
      name: basename(path),
      projectCount: projects.length,
    });
  }

  return suggestions.sort((a, b) => b.projectCount - a.projectCount);
}
