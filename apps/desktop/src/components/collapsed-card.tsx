import { Clock, Disc, Pause, Play } from "@phosphor-icons/react";
import { type KeyboardEvent, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePreviewStore } from "@/lib/preview-store";
import type { Project, Save } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  buildChips,
  type Chip,
  formatSizeDelta,
  getSaveDisplayTitle,
} from "./timeline-utils";
import { TrackThumbnail } from "./track-thumbnail";

export function CollapsedCard({
  save,
  isSelected,
  isHead,
  project,
  onClick,
}: {
  save: Save;
  isSelected: boolean;
  isHead: boolean;
  project: Project;
  onClick: () => void;
}) {
  const openPreviewPlayer = usePreviewStore((s) => s.openPreviewPlayer);
  const previewPlayerSaveId = usePreviewStore((s) => s.previewPlayerSaveId);
  const chips = useMemo(() => buildChips(save), [save]);
  const MAX_CHIPS = 3;
  const visible = chips.slice(0, MAX_CHIPS);
  const overflow = chips.length - MAX_CHIPS;
  const hasChips = save.setDiff !== undefined || save.changes !== undefined;
  let fallbackText: string | null = null;
  if (hasChips && chips.length === 0) {
    const delta = save.changes?.sizeDelta ?? 0;
    fallbackText =
      delta === 0
        ? "No file changes"
        : `Set file updated ${formatSizeDelta(delta)}`;
  }
  const chipColor = (kind: Chip["kind"]) => {
    if (kind === "add") {
      return "text-emerald-400/80 bg-emerald-400/10 border-emerald-400/15";
    }
    if (kind === "remove") {
      return "text-red-400/80 bg-red-400/10 border-red-400/15";
    }
    if (kind === "change") {
      return "text-amber-400/80 bg-amber-400/10 border-amber-400/15";
    }
    return "text-white/40 bg-white/[0.04] border-white/[0.06]";
  };
  const hasThumbnail = save.trackSummary && save.trackSummary.length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onClick();
  };

  return (
    <div
      aria-expanded={isSelected}
      className={cn(
        "flex min-h-[70px] w-full cursor-pointer items-center gap-4 rounded-2xl px-5 py-3.5 text-left transition-[background-color,box-shadow] duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20",
        isSelected
          ? "bg-white/[0.055] shadow-[0_0_0_1px_oklch(1_0_0/0.075)]"
          : "hover:bg-white/[0.025]"
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      {/* Checkpoint kind */}
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-xl",
          isSelected
            ? "bg-white/10 text-white/70"
            : isHead
              ? "bg-emerald-400/10 text-emerald-300"
              : "bg-white/[0.045] text-white/25"
        )}
      >
        {save.auto ? <Clock size={14} /> : <Disc size={14} weight="fill" />}
      </div>

      {/* Label + chips stacked tight */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate font-medium text-[13px] leading-tight",
              isSelected ? "text-white/90" : "text-white/70"
            )}
          >
            {getSaveDisplayTitle(save)}
          </span>
          {!save.auto && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    className="h-auto shrink-0 rounded border-transparent bg-emerald-400/8 px-1 py-0 text-[10px] text-emerald-400/60 uppercase leading-tight tracking-widest"
                    variant="secondary"
                  >
                    saved
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top">
                  You pressed Save in Ableton — other entries are automatic
                  snapshots
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {hasChips && (
          <div className="flex flex-wrap items-center gap-1">
            {fallbackText ? (
              <span className="text-[11px] text-white/20">{fallbackText}</span>
            ) : (
              <>
                {visible.map((chip) => (
                  <Badge
                    className={cn(
                      "h-auto rounded px-1 py-0 font-mono text-[10px] leading-tight",
                      chipColor(chip.kind)
                    )}
                    key={chip.label}
                    variant="outline"
                  >
                    {chip.label}
                  </Badge>
                ))}
                {overflow > 0 && (
                  <span className="ml-0.5 text-[11px] text-white/20">
                    +{overflow}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Track thumbnail — right-aligned */}
      {hasThumbnail && (
        <TrackThumbnail
          className="ml-auto shrink-0"
          tracks={save.trackSummary!}
        />
      )}

      {/* Inline play button */}
      {save.previewStatus === "ready" && (
        <button
          aria-label={
            previewPlayerSaveId === save.id ? "Now playing" : "Play preview"
          }
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-100 active:scale-[0.96]",
            previewPlayerSaveId === save.id
              ? "bg-white/15 text-white/70"
              : "text-white/20 hover:bg-white/[0.06] hover:text-white/50"
          )}
          onClick={(e) => {
            e.stopPropagation();
            openPreviewPlayer(save.id, project);
          }}
          type="button"
        >
          {previewPlayerSaveId === save.id ? (
            <Pause size={11} weight="fill" />
          ) : (
            <Play size={11} weight="fill" />
          )}
        </button>
      )}
    </div>
  );
}
