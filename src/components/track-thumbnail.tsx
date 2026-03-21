import type { TrackSummaryItem } from '@/lib/types';

// Ableton Live color palette (indices 0–69).
// Extracted from Ableton's XML schema — these are the sRGB hex values
// for the 70 clip/track colors in Live 10/11/12.
const ABLETON_COLORS: string[] = [
  '#FF94A6',
  '#FFA529',
  '#CC9927',
  '#F7F47C',
  '#BFFB00',
  '#1AFF2F',
  '#25FFA8',
  '#5CFFE8',
  '#8BC5FF',
  '#5480E4',
  '#92A7FF',
  '#D86CE4',
  '#E553A0',
  '#FFFFFF',
  '#FF3636',
  '#F66C03',
  '#99724B',
  '#FFF034',
  '#87FF67',
  '#3DC300',
  '#00BFAF',
  '#19E9FF',
  '#10A4EE',
  '#007DC0',
  '#886CE4',
  '#B677C6',
  '#FF39D4',
  '#D0D0D0',
  '#E2675A',
  '#FFA374',
  '#D4AD71',
  '#E8E55C',
  '#98B954',
  '#56C733',
  '#00A279',
  '#3FC0D2',
  '#82B3F2',
  '#4668C4',
  '#8E69CF',
  '#A34FA5',
  '#EB57A3',
  '#A0A0A0',
  '#CC3B3C',
  '#D47B35',
  '#A07843',
  '#C4B946',
  '#84A131',
  '#539F31',
  '#0F7B3F',
  '#2FA09E',
  '#4A7CAD',
  '#3B55A1',
  '#6847A4',
  '#A04F8D',
  '#BE478E',
  '#707070',
  '#AF3333',
  '#A95131',
  '#724F41',
  '#9F9B27',
  '#6E8C22',
  '#53742F',
  '#274F2D',
  '#254D52',
  '#3B5E7E',
  '#254475',
  '#4D3478',
  '#6B3662',
  '#A33E64',
  '#535353',
];

// Fallback colors by track type when the Ableton index is missing or -1
const TYPE_FALLBACK: Record<string, string> = {
  midi: '#5480E4',
  audio: '#FFA529',
  return: '#1AFF2F',
  group: '#886CE4',
};

function trackColor(track: TrackSummaryItem): string {
  if (track.color >= 0 && track.color < ABLETON_COLORS.length) {
    return ABLETON_COLORS[track.color]!;
  }
  return TYPE_FALLBACK[track.type] ?? '#707070';
}

/**
 * Compact visual thumbnail showing track layout of a save.
 * Each track is a colored rectangle; width proportional to clip count (min 1).
 * Renders as a single row of thin blocks — like a miniature arrangement view.
 */
export function TrackThumbnail({
  tracks,
  className,
}: {
  tracks: TrackSummaryItem[];
  className?: string;
}) {
  if (tracks.length === 0) return null;

  // Compute proportional widths: each track gets at least 1 unit
  const weights = tracks.map((t) => Math.max(1, t.clipCount));
  const total = weights.reduce((a, b) => a + b, 0);

  return (
    <div
      className={className}
      role="img"
      aria-label={`${tracks.length} tracks`}
    >
      <div className="flex h-[6px] rounded-[2px] overflow-hidden gap-px">
        {tracks.map((track, i) => {
          const pct = (weights[i]! / total) * 100;
          return (
            <div
              key={`${track.type}-${track.name}-${i}`}
              className="h-full min-w-[2px]"
              style={{
                width: `${Math.max(pct, 1.5)}%`,
                backgroundColor: trackColor(track),
                opacity: 0.7,
              }}
              title={`${track.name} (${track.type}, ${track.clipCount} clips)`}
            />
          );
        })}
      </div>
    </div>
  );
}
