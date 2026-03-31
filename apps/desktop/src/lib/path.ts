/** Browser-safe path utilities (no node:path dependency) */

export function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const i = normalized.lastIndexOf("/");
  return i === -1 ? normalized : normalized.slice(i + 1);
}

export function extname(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i);
}
