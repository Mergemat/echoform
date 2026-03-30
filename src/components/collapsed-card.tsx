import { Pause, Play } from "@phosphor-icons/react";
import { useMemo } from "react";
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

  return (
    <button
      className={cn(
        "flex min-h-[44px] w-full items-center gap-2.5 py-3 pr-4 pl-4 text-left transition-all duration-150",
        isSelected
          ? "border-white/50 border-l-2 bg-white/[0.06]"
          : "border-transparent border-l-2 hover:bg-white/[0.03]"
      )}
      onClick={onClick}
      type="button"
    >
      {/* Dot */}
      <div
        className={cn(
          "size-2 shrink-0 rounded-full ring-2",
          isSelected
            ? "bg-white ring-white/20"
            : isHead
              ? "bg-emerald-400 ring-emerald-400/20"
              : save.auto
                ? "bg-white/15 ring-white/[0.04]"
                : "bg-white/40 ring-white/10"
        )}
      />

      {/* Label + chips stacked tight */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate text-[13px] leading-tight",
              isSelected ? "font-medium text-white/90" : "text-white/55"
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
            "flex size-6 shrink-0 items-center justify-center rounded-full transition-all",
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
    </button>
  );
}
