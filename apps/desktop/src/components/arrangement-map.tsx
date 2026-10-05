import { useState } from "react";
import { abletonColor } from "@/lib/ableton-colors";
import { displayTrackName } from "@/lib/track-name";
import type { ClipAnalysis, SaveAnalysis, TrackAnalysis } from "@/lib/types";
import { cn } from "@/lib/utils";

const LABEL_WIDTH = "9.5rem";

export interface SelectedClip {
  clip: ClipAnalysis;
  track: TrackAnalysis;
}

function pct(beats: number, length: number) {
  return `${(beats / Math.max(length, 1)) * 100}%`;
}

function barRange(clip: ClipAnalysis, perBar: number): string {
  const first = Math.floor(clip.start / perBar) + 1;
  const last = Math.max(first, Math.ceil(clip.end / perBar));
  return first === last ? `bar ${first}` : `bars ${first}–${last}`;
}

const STATUS_TEXT: Record<ClipAnalysis["status"], string> = {
  added: "new",
  edited: "edited",
  moved: "moved",
  removed: "removed",
  same: "unchanged",
};

function ClipBlock({
  clip,
  track,
  length,
  perBar,
  selected,
  onSelect,
}: {
  clip: ClipAnalysis;
  track: TrackAnalysis;
  length: number;
  perBar: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const color = abletonColor(track.color);
  const width = `max(2px, ${pct(clip.end - clip.start, length)})`;
  const noteCount = clip.notes
    ? ` · ${clip.notes.added.length} notes added, ${clip.notes.removed.length} removed`
    : "";
  const title = `${clip.name || track.name} · ${barRange(clip, perBar)} · ${STATUS_TEXT[clip.status]}${noteCount}`;
  const selectable = clip.notes !== null;

  return (
    <>
      {clip.movedFrom !== null && (
        <span
          aria-hidden
          className="absolute inset-y-[3px] rounded-[2px] border border-subtle-foreground border-dashed"
          style={{ left: pct(clip.movedFrom, length), width }}
        />
      )}
      <button
        aria-label={title}
        className={cn(
          "absolute inset-y-[3px] overflow-hidden rounded-[2px] text-left outline-none focus-visible:ring-1 focus-visible:ring-foreground",
          clip.status === "removed" && "hatch-removed border border-removed/70",
          selected && "ring-1 ring-foreground",
          selectable ? "cursor-pointer" : "cursor-default"
        )}
        disabled={!selectable}
        onClick={onSelect}
        style={{
          backgroundColor:
            clip.status === "removed"
              ? undefined
              : clip.status === "same"
                ? `color-mix(in srgb, ${color} 26%, transparent)`
                : color,
          left: pct(clip.start, length),
          width,
        }}
        title={title}
        type="button"
      >
        {clip.status === "edited" && (
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-[2px] bg-edited"
          />
        )}
      </button>
    </>
  );
}

/**
 * The checkpoint's arrangement: one row per track, clips placed by bar,
 * drawn by what happened to them since the previous checkpoint.
 */
export function ArrangementMap({
  analysis,
  selected,
  onSelectClip,
}: {
  analysis: SaveAnalysis;
  selected: SelectedClip | null;
  onSelectClip: (selection: SelectedClip) => void;
}) {
  const changed = analysis.tracks.filter((t) => t.status !== "same");
  const [showAll, setShowAll] = useState(changed.length === 0);
  const tracks = (showAll ? analysis.tracks : changed).filter(
    (t) => t.clips.length > 0 || t.status !== "same" || t.type === "group"
  );
  const length = Math.max(analysis.lengthBeats, analysis.beatsPerBar * 4);
  const hidden = analysis.tracks.length - changed.length;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="font-medium text-[12px] text-muted-foreground">
          Arrangement
        </h3>
        {changed.length > 0 && hidden > 0 && (
          <button
            className="text-[11px] text-subtle-foreground hover:text-foreground"
            onClick={() => setShowAll((v) => !v)}
            type="button"
          >
            {showAll
              ? "Changed tracks only"
              : `Show all ${analysis.tracks.length} tracks`}
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-sidebar">
        <div
          className="grid border-line border-b"
          style={{ gridTemplateColumns: `${LABEL_WIDTH} 1fr` }}
        >
          <span />
          <div className="relative">
            <BarRuler beatsPerBar={analysis.beatsPerBar} scaleBeats={length} />
            {analysis.locators.map((locator) => (
              <span
                className="absolute top-0 h-full border-muted-foreground/60 border-l"
                key={`${locator.time}-${locator.name}`}
                style={{ left: pct(locator.time, length) }}
                title={locator.name || "Locator"}
              />
            ))}
          </div>
        </div>

        {tracks.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-subtle-foreground">
            No clips in the arrangement.
          </p>
        ) : (
          tracks.map((track) => (
            <div
              className={cn(
                "grid border-line/60 border-b last:border-b-0",
                track.status === "same" && "opacity-55"
              )}
              key={`${track.id}-${track.status}`}
              style={{ gridTemplateColumns: `${LABEL_WIDTH} 1fr` }}
            >
              <div
                className="flex min-w-0 items-center gap-1.5 border-line border-r py-1 pr-2 text-[11px]"
                style={{ paddingLeft: `${0.5 + track.depth * 0.6}rem` }}
                title={track.name}
              >
                <span
                  className="h-3 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: abletonColor(track.color) }}
                />
                <span
                  className={cn(
                    "truncate",
                    track.status === "removed" && "text-removed line-through",
                    track.status === "added" && "text-added",
                    track.type === "group" && "font-medium"
                  )}
                >
                  {displayTrackName(track.name)}
                </span>
              </div>
              <div
                className="relative h-6"
                style={{
                  backgroundImage: `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${pct(analysis.beatsPerBar * 4, length)})`,
                  backgroundSize: "100% 100%",
                }}
              >
                {track.clips.map((clip) => (
                  <ClipBlock
                    clip={clip}
                    key={`${clip.start}-${clip.end}-${clip.status}-${clip.name}`}
                    length={length}
                    onSelect={() => onSelectClip({ clip, track })}
                    perBar={analysis.beatsPerBar}
                    selected={selected?.clip === clip}
                    track={track}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-subtle-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-[1px] bg-muted-foreground" /> new
        </span>
        <span className="flex items-center gap-1.5">
          <span className="relative h-2 w-3 rounded-[1px] bg-muted-foreground">
            <span className="absolute inset-x-0 top-0 h-[2px] bg-edited" />
          </span>
          edited
        </span>
        <span className="flex items-center gap-1.5">
          <span className="hatch-removed h-2 w-3 rounded-[1px] border border-removed/70" />
          removed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-[1px] border border-subtle-foreground border-dashed" />
          moved from
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-[1px] bg-muted-foreground/30" />{" "}
          unchanged
        </span>
      </div>
    </div>
  );
}

/** Bar numbers along the top of the arrangement map. */
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
