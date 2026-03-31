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
  midi: "#5480E4",
  audio: "#FFA529",
  return: "#1AFF2F",
  group: "#886CE4",
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
      { key, track, depth },
      ...flattenTracks(track.children ?? [], key, depth + 1),
    ];
  });
}

function trackTitle(track: TrackSummaryItem): string {
  if (track.type !== "group") {
    return `${track.name} (${track.type}, ${track.clipCount} clips)`;
  }

  const nestedTracks = Math.max(0, (track.trackCount ?? 1) - 1);
  return `${track.name} (${nestedTracks} nested tracks, ${track.clipCount} clips)`;
}

/**
 * Flatten tracks to at most `maxDepth` levels deep.
 * Keeps group structure visible without exploding height for deeply nested sets.
 */
function flattenTracksShallow(
  tracks: TrackSummaryItem[],
  maxDepth: number,
  parentKey = "root",
  depth = 0
): Array<{ key: string; track: TrackSummaryItem; depth: number }> {
  return tracks.flatMap((track, index) => {
    const key = `${parentKey}/${track.type}:${track.name}:${index}`;
    return [
      { key, track, depth },
      ...(depth < maxDepth
        ? flattenTracksShallow(track.children ?? [], maxDepth, key, depth + 1)
        : []),
    ];
  });
}

/**
 * Compact visual thumbnail showing track layout of a save.
 * Multi-line with indentation so groups are visible, but kept tight:
 * - compact: 2px rows, max 1 nesting level, capped row count
 * - detail: 3px rows, full nesting, higher cap
 */
export function TrackThumbnail({
  tracks,
  className,
  variant = "compact",
}: {
  tracks: TrackSummaryItem[];
  className?: string;
  /** "compact" = tight rows for collapsed cards, "detail" = fuller view for expanded cards */
  variant?: "compact" | "detail";
}) {
  if (tracks.length === 0) {
    return null;
  }

  const isCompact = variant === "compact";
  const maxDepth = isCompact ? 1 : 4;
  const maxRows = isCompact ? 8 : 20;
  const indentPx = isCompact ? 4 : 6;

  const rows = isCompact
    ? flattenTracksShallow(tracks, maxDepth)
    : flattenTracks(tracks);
  const visible = rows.slice(0, maxRows);
  const overflow = rows.length - maxRows;

  if (isCompact) {
    return (
      <div
        aria-label={`${rows.length} tracks`}
        className={className}
        role="img"
      >
        <div className="flex w-[80px] flex-col gap-[1px]">
          {visible.map(({ key, track, depth }) => {
            const indent = Math.min(depth, 4) * 4;
            return (
              <div
                className="rounded-full"
                key={key}
                style={{
                  height: "2px",
                  marginLeft: `${indent}px`,
                  backgroundColor: trackColor(track),
                  opacity: track.type === "group" ? 0.45 : 0.35,
                }}
                title={trackTitle(track)}
              />
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div aria-label={`${rows.length} tracks`} className={className} role="img">
      <div className="space-y-px rounded border border-white/[0.04] bg-white/[0.03] p-0.5">
        {visible.map(({ key, track, depth }) => {
          const indent = Math.min(depth, 4) * indentPx;
          const guideOffset = Math.max(indent - 3, 0);
          return (
            <div
              className="relative h-[2px] overflow-hidden rounded-[1px] bg-white/[0.05]"
              key={key}
              title={trackTitle(track)}
            >
              {depth > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-white/10"
                  style={{ left: `${guideOffset}px` }}
                />
              )}
              <div
                className="absolute top-0 bottom-0 rounded-[1px]"
                style={{
                  left: `${indent}px`,
                  right: "0px",
                  backgroundColor: trackColor(track),
                  opacity: track.type === "group" ? 0.55 : 0.4,
                  boxShadow:
                    track.type === "group"
                      ? "inset 0 0 0 0.5px rgba(255,255,255,0.08)"
                      : undefined,
                }}
              />
            </div>
          );
        })}
        {overflow > 0 && (
          <div className="pt-0.5 text-center text-[10px] text-white/15">
            +{overflow} more
          </div>
        )}
      </div>
    </div>
  );
}
