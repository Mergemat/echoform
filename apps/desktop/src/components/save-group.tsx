import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { Save } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatSizeDelta } from "./timeline-utils";

export function GroupCard({
  saves,
  expanded,
  onToggle,
}: {
  saves: Save[];
  groupKey: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const totalDelta = saves.reduce(
    (sum, s) => sum + (s.changes?.sizeDelta ?? 0),
    0
  );
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 border-transparent border-l-2 py-3 pr-4 pl-3 text-left transition-all duration-150 hover:bg-white/[0.02]"
      )}
      onClick={onToggle}
      type="button"
    >
      {expanded ? (
        <CaretDown className="shrink-0 text-white/25" size={10} />
      ) : (
        <CaretRight className="shrink-0 text-white/25" size={10} />
      )}
      <span className="font-medium text-[11px] text-white/25 uppercase tracking-wider">
        {saves.length} auto saves
      </span>
      {totalDelta !== 0 && (
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums",
            totalDelta > 0 ? "text-emerald-400/35" : "text-red-400/35"
          )}
        >
          {formatSizeDelta(totalDelta)}
        </span>
      )}
    </button>
  );
}
