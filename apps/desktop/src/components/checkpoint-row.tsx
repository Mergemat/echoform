import {
  ChatText,
  GitBranch,
  Pause,
  Play,
  PushPin,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import { usePreviewStore } from "@/lib/preview-store";
import type { Project, Save } from "@/lib/types";
import { cn } from "@/lib/utils";
import { buildChips, type Chip, formatTime } from "./timeline-utils";

const MAX_CHIPS = 4;

export const CHIP_CLASS: Record<Chip["kind"], string> = {
  add: "text-success bg-success/10",
  change: "text-warning bg-warning/10",
  neutral: "text-muted-foreground bg-muted",
  remove: "text-destructive bg-destructive/10",
};

/** What to say when a checkpoint has no structural changes to show. */
export function describeUnchangedSave(project: Project, save: Save): string {
  if (!save.auto && project.continuedFrom) {
    return "Starting point of this branch";
  }
  if (project.ideas.some((idea) => idea.baseSaveId === save.id)) {
    return "First checkpoint of this set";
  }
  if (save.setDiff === undefined && save.changes === undefined) {
    return "Not analyzed yet";
  }
  return "Small edits — no tracks, devices or clips changed";
}

export function CheckpointRow({
  save,
  isSelected,
  isHead,
  project,
  indented = false,
  onClick,
}: {
  save: Save;
  isSelected: boolean;
  isHead: boolean;
  project: Project;
  indented?: boolean;
  onClick: () => void;
}) {
  const openPreviewPlayer = usePreviewStore((s) => s.openPreviewPlayer);
  const previewPlayerSaveId = usePreviewStore((s) => s.previewPlayerSaveId);
  const chips = useMemo(() => buildChips(save), [save]);
  const visible = chips.slice(0, MAX_CHIPS);
  const overflow = chips.length - MAX_CHIPS;
  const isBranchStart = !save.auto && Boolean(project.continuedFrom);
  const isPlaying = previewPlayerSaveId === save.id;
  const title = save.customLabel ? save.label.trim() : null;

  return (
    <div
      className={cn(
        "group relative flex items-center gap-4 rounded-lg py-2.5 pr-2 pl-3 transition-colors duration-100",
        indented && "ml-6",
        isSelected ? "bg-accent" : "hover:bg-accent/40"
      )}
    >
      {/* The whole row selects; nested controls sit above this layer. */}
      <button
        aria-label={`Checkpoint at ${formatTime(save.createdAt)}${title ? `: ${title}` : ""}`}
        aria-pressed={isSelected}
        className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onClick}
        type="button"
      />

      <span
        className={cn(
          "pointer-events-none w-16 shrink-0 text-[12px] tabular-nums",
          isSelected ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {formatTime(save.createdAt)}
      </span>

      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-1">
        {title && (
          <span className="truncate font-medium text-[13px] text-foreground">
            {title}
          </span>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {visible.length === 0 ? (
            <span className="text-[12px] text-subtle-foreground">
              {describeUnchangedSave(project, save)}
            </span>
          ) : (
            <>
              {visible.map((chip) => (
                <span
                  className={cn(
                    "rounded px-1.5 py-px text-[11px] leading-[18px]",
                    CHIP_CLASS[chip.kind]
                  )}
                  key={chip.label}
                >
                  {chip.label}
                </span>
              ))}
              {overflow > 0 && (
                <span className="text-[11px] text-subtle-foreground">
                  +{overflow} more
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <div className="pointer-events-none flex shrink-0 items-center gap-2 text-subtle-foreground">
        {save.note.trim() && <ChatText aria-label="Has a note" size={14} />}
        {save.pinned && <PushPin aria-label="Pinned" size={14} weight="fill" />}
        {isBranchStart && (
          <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
            <GitBranch size={11} />
            Branch start
          </span>
        )}
        {isHead && (
          <span className="rounded bg-success/10 px-1.5 py-px font-medium text-[11px] text-success">
            Latest
          </span>
        )}
      </div>

      {save.previewStatus === "ready" ? (
        <button
          aria-label={isPlaying ? "Now playing" : "Play preview"}
          className={cn(
            "relative flex size-7 shrink-0 items-center justify-center rounded-full transition-colors duration-100",
            isPlaying
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
          onClick={() => openPreviewPlayer(save.id, project)}
          type="button"
        >
          {isPlaying ? (
            <Pause size={11} weight="fill" />
          ) : (
            <Play size={11} weight="fill" />
          )}
        </button>
      ) : (
        <span aria-hidden className="size-7 shrink-0" />
      )}
    </div>
  );
}
