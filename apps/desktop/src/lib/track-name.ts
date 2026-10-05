/**
 * How a producer refers to a track: without Live's auto-number ("4-Serum 2"
 * → "Serum 2") and without the "[2026-01-10 084550]" suffix Live adds to
 * consolidated audio. Mirrors displayName in packages/server/src/set-compare.ts.
 */
export function displayTrackName(name: string): string {
  return (
    name
      .replace(/^\d+-/, "")
      .replace(/\s*\[\d{4}-\d{2}-\d{2} \d{6}\]$/, "")
      .trim() || name
  );
}
