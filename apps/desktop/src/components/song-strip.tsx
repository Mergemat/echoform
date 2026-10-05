import { useId } from "react";
import { abletonColor } from "@/lib/ableton-colors";
import type { SaveSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const HEIGHT = 24;

/**
 * One checkpoint's song as a silhouette: how many tracks play across the
 * arrangement, with the parts that changed lit in their track colours.
 * Rows share `scaleBeats`, so stacked strips line up bar for bar.
 */
export function SongStrip({
  summary,
  scaleBeats,
  className,
  muted = false,
}: {
  summary: SaveSummary;
  scaleBeats: number;
  className?: string;
  muted?: boolean;
}) {
  const clipId = useId();
  const scale = Math.max(scaleBeats, summary.lengthBeats, 1);
  const bucket = summary.lengthBeats / summary.shape.length;
  const bars = summary.shape
    .map((value, i) => ({ value, x: i * bucket }))
    .map(({ value, x }) => {
      const height = value > 0 ? Math.max(2, value * HEIGHT) : 0.6;
      return (
        <rect
          height={height}
          key={x}
          width={bucket * 0.72}
          x={x + bucket * 0.14}
          y={(HEIGHT - height) / 2}
        />
      );
    });

  return (
    <svg
      aria-hidden
      className={cn("block h-6 w-full", className)}
      preserveAspectRatio="none"
      viewBox={`0 0 ${scale} ${HEIGHT}`}
    >
      <g
        className={
          muted ? "fill-subtle-foreground/40" : "fill-subtle-foreground/70"
        }
      >
        {bars}
      </g>
      {summary.regions.map((region) => {
        const key = `${region.start}-${region.end}-${region.color}`;
        return (
          <g key={key}>
            <clipPath id={`${clipId}-${key}`}>
              <rect
                height={HEIGHT}
                width={region.end - region.start}
                x={region.start}
                y={0}
              />
            </clipPath>
            <rect
              fill={abletonColor(region.color)}
              height={HEIGHT}
              opacity={0.14}
              width={region.end - region.start}
              x={region.start}
            />
            <g
              clipPath={`url(#${clipId}-${key})`}
              fill={abletonColor(region.color)}
            >
              {bars}
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/** Bar numbers aligned with SongStrip rows that share the same scale. */
export function BarRuler({
  scaleBeats,
  beatsPerBar,
  className,
}: {
  scaleBeats: number;
  beatsPerBar: number;
  className?: string;
}) {
  const totalBars = Math.max(1, Math.ceil(scaleBeats / beatsPerBar));
  const step = [1, 2, 4, 8, 16, 32, 64].find((s) => totalBars / s <= 8) ?? 128;
  const marks: number[] = [];
  for (let bar = 1; bar <= totalBars; bar += step) {
    marks.push(bar);
  }
  return (
    <div
      className={cn(
        "relative h-4 font-mono text-[10px] text-subtle-foreground",
        className
      )}
    >
      {marks.map((bar) => (
        <span
          className="absolute top-0 -translate-x-px border-line border-l pl-1 leading-4"
          key={bar}
          style={{
            left: `${(((bar - 1) * beatsPerBar) / Math.max(scaleBeats, 1)) * 100}%`,
          }}
        >
          {bar}
        </span>
      ))}
    </div>
  );
}
