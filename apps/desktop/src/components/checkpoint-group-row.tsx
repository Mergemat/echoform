import { CaretRight } from "@phosphor-icons/react";
import type { Save } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatTime } from "./timeline-utils";

/** A run of consecutive saves with no structural changes, collapsed into one row. */
export function CheckpointGroupRow({
  saves,
  expanded,
  onToggle,
}: {
  saves: Save[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const oldest = saves.at(-1);

  return (
    <button
      aria-expanded={expanded}
      className="flex w-full items-center gap-4 rounded-lg py-2 pr-2 pl-3 text-left transition-colors duration-100 hover:bg-accent/40"
      onClick={onToggle}
      type="button"
    >
      <span aria-hidden className="w-16 shrink-0" />
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <CaretRight
          className={cn(
            "shrink-0 transition-transform duration-150",
            expanded && "rotate-90"
          )}
          size={11}
        />
        {expanded ? "Hide" : "Show"} {saves.length} saves with small edits
        {oldest && saves[0] && (
          <span className="text-subtle-foreground">
            · {formatTime(oldest.createdAt)}–{formatTime(saves[0].createdAt)}
          </span>
        )}
      </span>
    </button>
  );
}
