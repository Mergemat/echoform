import { abletonColor } from "@/lib/ableton-colors";
import { displayTrackName } from "@/lib/track-name";
import type { MiniNote } from "@/lib/types";
import type { SelectedClip } from "./arrangement-map";

const NOTE_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];

function noteName(key: number): string {
  return `${NOTE_NAMES[key % 12]}${Math.floor(key / 12) - 2}`;
}

/** Notes of one clip: kept in grey, new in the track colour, removed outlined in red. */
export function PianoRollDiff({
  selection,
  beatsPerBar,
}: {
  selection: SelectedClip;
  beatsPerBar: number;
}) {
  const { clip, track } = selection;
  const notes = clip.notes;
  if (!notes) {
    return null;
  }
  const all: MiniNote[] = [...notes.kept, ...notes.added, ...notes.removed];
  if (all.length === 0) {
    return (
      <p className="text-[12px] text-subtle-foreground">
        This clip has no notes.
      </p>
    );
  }

  const low = Math.min(...all.map((n) => n.k)) - 1;
  const high = Math.max(...all.map((n) => n.k)) + 1;
  const keys = high - low + 1;
  const span = Math.max(
    clip.end - clip.start,
    ...all.map((n) => n.t + n.d),
    beatsPerBar
  );
  const rowHeight = keys > 36 ? 4 : keys > 18 ? 6 : 9;
  const height = keys * rowHeight;
  const color = abletonColor(track.color);
  const y = (key: number) => (high - key) * rowHeight;
  const firstBar = Math.floor(clip.start / beatsPerBar) + 1;

  const bars: number[] = [];
  for (let beat = 0; beat <= span; beat += beatsPerBar) {
    bars.push(beat);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h3 className="truncate font-medium text-[12px] text-muted-foreground">
          {clip.name || displayTrackName(track.name)}
          <span className="text-subtle-foreground"> · from bar {firstBar}</span>
        </h3>
        <span className="shrink-0 font-mono text-[11px] text-subtle-foreground">
          <span className="text-added">+{notes.added.length}</span>{" "}
          <span className="text-removed">−{notes.removed.length}</span> notes
        </span>
      </div>
      <div className="flex overflow-hidden rounded-lg border border-line bg-sidebar">
        <div
          className="relative w-9 shrink-0 border-line border-r font-mono text-[9px] text-subtle-foreground"
          style={{ height }}
        >
          {Array.from({ length: keys }, (_, i) => high - i)
            .filter((key) => key % 12 === 0)
            .map((key) => (
              <span
                className="absolute right-1"
                key={key}
                style={{ top: y(key) - 2 }}
              >
                {noteName(key)}
              </span>
            ))}
        </div>
        <svg
          aria-label={`Piano roll for ${clip.name || track.name}`}
          className="block w-full"
          height={height}
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${span} ${height}`}
        >
          {Array.from({ length: keys }, (_, i) => high - i)
            .filter((key) => [1, 3, 6, 8, 10].includes(key % 12))
            .map((key) => (
              <rect
                fill="var(--raised)"
                height={rowHeight}
                key={key}
                width={span}
                x={0}
                y={y(key)}
              />
            ))}
          {bars.map((beat) => (
            <rect
              fill="var(--line)"
              height={height}
              key={beat}
              width={span / 600}
              x={beat}
              y={0}
            />
          ))}
          {notes.kept.map((n) => (
            <rect
              fill="var(--muted-foreground)"
              height={rowHeight - 1}
              key={`k${n.k}-${n.t}`}
              opacity={0.45}
              rx={0.04}
              width={Math.max(n.d, span / 400)}
              x={n.t}
              y={y(n.k) + 0.5}
            />
          ))}
          {notes.removed.map((n) => (
            <rect
              fill="none"
              height={rowHeight - 1}
              key={`r${n.k}-${n.t}`}
              stroke="var(--removed)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              width={Math.max(n.d, span / 400)}
              x={n.t}
              y={y(n.k) + 0.5}
            />
          ))}
          {notes.added.map((n) => (
            <rect
              fill={color}
              height={rowHeight - 1}
              key={`a${n.k}-${n.t}`}
              width={Math.max(n.d, span / 400)}
              x={n.t}
              y={y(n.k) + 0.5}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
