import {
  ChatText,
  GitBranch,
  Pause,
  Play,
  PushPin,
} from "@phosphor-icons/react";
import { usePreviewStore } from "@/lib/preview-store";
import type { Project, Save } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SongStrip } from "./song-strip";
import { formatTime } from "./timeline-utils";

/**
 * Shared column template so rows, group rows and the ruler line up.
 * Compact (detail panel open): the description sits under the strip.
 */
export function rowGrid(compact: boolean): string {
  return compact
    ? "grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] items-center gap-x-3"
    : "grid grid-cols-[4.5rem_minmax(9rem,18rem)_minmax(0,1fr)_5.5rem] items-center gap-x-4";
}

export function describeSave(project: Project, save: Save): string {
  if (!save.auto && project.continuedFrom) {
    return "Starting point of this branch";
  }
  if (!save.summary) {
    return "Analyzing…";
  }
  return save.summary.headline;
}

export function CheckpointRow({
  save,
  isSelected,
  isHead,
  project,
  scaleBeats,
  compact = false,
  indented = false,
  onClick,
}: {
  save: Save;
  isSelected: boolean;
  isHead: boolean;
  project: Project;
  scaleBeats: number;
  compact?: boolean;
  indented?: boolean;
  onClick: () => void;
}) {
  const openPreviewPlayer = usePreviewStore((s) => s.openPreviewPlayer);
  const previewPlayerSaveId = usePreviewStore((s) => s.previewPlayerSaveId);
  const isBranchStart = !save.auto && Boolean(project.continuedFrom);
  const isPlaying = previewPlayerSaveId === save.id;
  const name = save.customLabel ? save.label.trim() : null;
  const quiet = save.summary?.weight === "none";

  return (
    <div
      className={cn(
        rowGrid(compact),
        "group relative rounded-md py-2 pr-2 pl-2 transition-colors duration-100",
        isSelected ? "bg-raised" : "hover:bg-raised/60"
      )}
    >
      {isSelected && (
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-foreground"
        />
      )}
      <button
        aria-label={`Checkpoint at ${formatTime(save.createdAt)}${name ? `: ${name}` : ""}`}
        aria-pressed={isSelected}
        className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onClick}
        type="button"
      />

      <span
        className={cn(
          "pointer-events-none font-mono text-[11px] tabular-nums",
          isSelected ? "text-foreground" : "text-muted-foreground",
          indented && "pl-2 text-subtle-foreground"
        )}
      >
        {formatTime(save.createdAt)}
      </span>

      {compact ? (
        <div className="pointer-events-none min-w-0 space-y-1">
          <div>
            {save.summary ? (
              <SongStrip
                muted={quiet}
                scaleBeats={scaleBeats}
                summary={save.summary}
              />
            ) : (
              <div className="h-6 animate-pulse rounded-sm bg-muted/60" />
            )}
          </div>

          <div className="min-w-0">
            {name && (
              <div className="truncate font-medium text-[13px] text-foreground">
                {name}
              </div>
            )}
            <div
              className={cn(
                "truncate text-[12.5px]",
                name || quiet
                  ? "text-subtle-foreground"
                  : "text-muted-foreground",
                isSelected && !name && !quiet && "text-foreground"
              )}
              title={describeSave(project, save)}
            >
              {describeSave(project, save)}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="pointer-events-none">
            {save.summary ? (
              <SongStrip
                muted={quiet}
                scaleBeats={scaleBeats}
                summary={save.summary}
              />
            ) : (
              <div className="h-6 animate-pulse rounded-sm bg-muted/60" />
            )}
          </div>

          <div className="pointer-events-none min-w-0">
            {name && (
              <div className="truncate font-medium text-[13px] text-foreground">
                {name}
              </div>
            )}
            <div
              className={cn(
                "truncate text-[12.5px]",
                name || quiet
                  ? "text-subtle-foreground"
                  : "text-muted-foreground",
                isSelected && !name && !quiet && "text-foreground"
              )}
              title={describeSave(project, save)}
            >
              {describeSave(project, save)}
            </div>
          </div>
        </>
      )}

      <div className="pointer-events-none flex items-center justify-end gap-2 text-subtle-foreground">
        {save.note.trim() && <ChatText aria-label="Has a note" size={13} />}
        {save.pinned && <PushPin aria-label="Pinned" size={13} weight="fill" />}
        {isBranchStart && <GitBranch aria-label="Branch start" size={13} />}
        {isHead && (
          <span className="font-mono text-[10px] text-foreground uppercase tracking-wider">
            Latest
          </span>
        )}
        {save.previewStatus === "ready" && (
          <button
            aria-label={isPlaying ? "Now playing" : "Play preview"}
            className={cn(
              "pointer-events-auto relative flex size-6 items-center justify-center rounded-full transition-colors",
              isPlaying
                ? "bg-foreground text-background"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
            onClick={() => openPreviewPlayer(save.id, project)}
            type="button"
          >
            {isPlaying ? (
              <Pause size={10} weight="fill" />
            ) : (
              <Play size={10} weight="fill" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
