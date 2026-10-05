import type { Save } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ROW_GRID } from "./checkpoint-row";

/** A run of saves where nothing in the song changed, collapsed into one row. */
export function CheckpointGroupRow({
  saves,
  expanded,
  onToggle,
}: {
  saves: Save[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={expanded}
      className={cn(
        ROW_GRID,
        "min-h-8 w-full rounded-md pr-2 pl-3 text-left text-[12.5px] text-subtle-foreground transition-colors hover:bg-raised/60 hover:text-muted-foreground"
      )}
      onClick={onToggle}
      type="button"
    >
      <span />
      <span className="relative flex items-center justify-center self-stretch">
        <span
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 border-line border-l border-dashed"
        />
      </span>
      <span>
        {expanded ? "Hide " : ""}
        {saves.length} saves with no changes
      </span>
      <span />
    </button>
  );
}
