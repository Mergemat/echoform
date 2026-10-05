/** Drop the "[2026-01-10 084550]" suffix Live adds to consolidated audio. */
export function displayTrackName(name: string): string {
  return name.replace(/\s*\[\d{4}-\d{2}-\d{2} \d{6}\]$/, "").trim() || name;
}
