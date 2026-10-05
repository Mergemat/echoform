import type { TrackSummaryItem } from "@/lib/types";

// Ableton Live color palette (indices 0–69).
// Extracted from Ableton's XML schema — these are the sRGB hex values
// for the 70 clip/track colors in Live 10/11/12.
const ABLETON_COLORS: string[] = [
  "#FF94A6",
  "#FFA529",
  "#CC9927",
  "#F7F47C",
  "#BFFB00",
  "#1AFF2F",
  "#25FFA8",
  "#5CFFE8",
  "#8BC5FF",
  "#5480E4",
  "#92A7FF",
  "#D86CE4",
  "#E553A0",
  "#FFFFFF",
  "#FF3636",
  "#F66C03",
  "#99724B",
  "#FFF034",
  "#87FF67",
  "#3DC300",
  "#00BFAF",
  "#19E9FF",
  "#10A4EE",
  "#007DC0",
  "#886CE4",
  "#B677C6",
  "#FF39D4",
  "#D0D0D0",
  "#E2675A",
  "#FFA374",
  "#D4AD71",
  "#E8E55C",
  "#98B954",
  "#56C733",
  "#00A279",
  "#3FC0D2",
  "#82B3F2",
  "#4668C4",
  "#8E69CF",
  "#A34FA5",
  "#EB57A3",
  "#A0A0A0",
  "#CC3B3C",
  "#D47B35",
  "#A07843",
  "#C4B946",
  "#84A131",
  "#539F31",
  "#0F7B3F",
  "#2FA09E",
  "#4A7CAD",
  "#3B55A1",
  "#6847A4",
  "#A04F8D",
  "#BE478E",
  "#707070",
  "#AF3333",
  "#A95131",
  "#724F41",
  "#9F9B27",
  "#6E8C22",
  "#53742F",
  "#274F2D",
  "#254D52",
  "#3B5E7E",
  "#254475",
  "#4D3478",
  "#6B3662",
  "#A33E64",
  "#535353",
];

// Fallback colors by track type when the Ableton index is missing or -1
const TYPE_FALLBACK: Record<string, string> = {
  audio: "#FFA529",
  group: "#886CE4",
  midi: "#5480E4",
  return: "#1AFF2F",
};

function trackColor(track: TrackSummaryItem): string {
  if (track.color >= 0 && track.color < ABLETON_COLORS.length) {
    return ABLETON_COLORS[track.color]!;
  }
  return TYPE_FALLBACK[track.type] ?? "#707070";
}

function flattenTracks(
  tracks: TrackSummaryItem[],
  parentKey = "root",
  depth = 0
): Array<{ key: string; track: TrackSummaryItem; depth: number }> {
  return tracks.flatMap((track, index) => {
    const key = `${parentKey}/${track.type}:${track.name}:${index}`;
    return [
      { depth, key, track },
      ...flattenTracks(track.children ?? [], key, depth + 1),
    ];
  });
}

const TYPE_LABEL: Record<string, string> = {
  audio: "Audio",
  group: "Group",
  midi: "MIDI",
  return: "Return",
};

/** The set's track layout as a readable, indented list. */
export function TrackList({ tracks }: { tracks: TrackSummaryItem[] }) {
  const rows = flattenTracks(tracks);
  if (rows.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-px">
      {rows.map(({ key, track, depth }) => (
        <li
          className="flex items-center gap-2 rounded px-1.5 py-[3px] text-[12px] hover:bg-accent/40"
          key={key}
          style={{ paddingLeft: `${6 + Math.min(depth, 4) * 14}px` }}
        >
          <span
            aria-hidden
            className="h-3 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: trackColor(track) }}
          />
          <span
            className={
              track.type === "group"
                ? "truncate font-medium text-foreground"
                : "truncate text-muted-foreground"
            }
          >
            {track.name}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-subtle-foreground">
            {TYPE_LABEL[track.type] ?? track.type}
            {track.type !== "group" && track.clipCount > 0
              ? ` · ${track.clipCount} clip${track.clipCount === 1 ? "" : "s"}`
              : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
