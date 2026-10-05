import { CaretRight } from "@phosphor-icons/react";
import type { Save } from "@/lib/types";
import { cn } from "@/lib/utils";
import { rowGrid } from "./checkpoint-row";
import { formatTime } from "./timeline-utils";

/** A run of saves where nothing in the song changed, collapsed into one row. */
export function CheckpointGroupRow({
  saves,
  expanded,
  compact = false,
  onToggle,
}: {
  compact?: boolean;
  saves: Save[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const newest = saves[0];
  const oldest = saves.at(-1);

  return (
    <button
      aria-expanded={expanded}
      className={cn(
        rowGrid(compact),
        "w-full rounded-md py-1.5 pr-2 pl-2 text-left text-subtle-foreground transition-colors hover:bg-raised/60 hover:text-muted-foreground"
      )}
      onClick={onToggle}
      type="button"
    >
      <span />
      <span className="flex items-center gap-1.5 text-[12px]">
        <CaretRight
          className={cn(
            "shrink-0 transition-transform duration-150",
            expanded && "rotate-90"
          )}
          size={10}
        />
        {saves.length} saves, nothing changed
      </span>
      <span
        className={cn(
          "font-mono text-[11px] tabular-nums",
          compact && "hidden"
        )}
      >
        {oldest && newest
          ? `${formatTime(oldest.createdAt)}–${formatTime(newest.createdAt)}`
          : null}
      </span>
      <span />
    </button>
  );
}
