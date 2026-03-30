import { CaretDown, CaretRight, GitFork } from "@phosphor-icons/react";
import type { Idea, Save } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getSaveDisplayTitle } from "./timeline-utils";

export function BranchCard({
  idea,
  fromSave,
  depth,
  isCurrent,
  isFocused,
  isCollapsed,
  saveCount,
  onToggleCollapse,
}: {
  idea: Idea;
  fromSave: Save | null;
  depth: number;
  isCurrent: boolean;
  isFocused: boolean;
  isCollapsed: boolean;
  saveCount: number;
  onToggleCollapse: () => void;
}) {
  const lineLeft = 16 + depth * 20;

  return (
    <button
      className={cn(
        "group w-full text-left transition-all duration-150",
        isFocused ? "bg-white/[0.04]" : "bg-transparent hover:bg-white/[0.02]"
      )}
      onClick={onToggleCollapse}
      type="button"
    >
      {/* Main row */}
      <div
        className="flex items-center gap-2 py-3.5 pr-4"
        style={{ paddingLeft: `${lineLeft}px` }}
      >
        {/* Branch dot + connector */}
        <div className="relative flex shrink-0 items-center">
          {depth > 0 && (
            <GitFork className="mr-0.5 text-white/15" size={12} weight="bold" />
          )}
          <div
            className={cn(
              "size-3 rounded-full border transition-colors",
              isCurrent
                ? "border-emerald-400/30 bg-emerald-400/80"
                : isFocused
                  ? "border-white/15 bg-white/30"
                  : "border-white/[0.06] bg-white/10"
            )}
          />
        </div>

        {/* Branch info */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn(
              "truncate font-medium text-[13px]",
              isFocused ? "text-white/85" : "text-white/40"
            )}
          >
            {idea.name}
          </span>
          {isCurrent && (
            <span className="shrink-0 font-medium text-[10px] text-emerald-400/60 uppercase tracking-[0.12em]">
              current
            </span>
          )}
          <span
            className={cn(
              "shrink-0 text-[11px] tabular-nums",
              isFocused ? "text-white/25" : "text-white/15"
            )}
          >
            {saveCount} {saveCount === 1 ? "save" : "saves"}
          </span>
        </div>

        {/* Expand/collapse chevron */}
        <div className="shrink-0">
          {isCollapsed ? (
            <CaretRight
              className="text-white/15 transition-colors group-hover:text-white/35"
              size={14}
            />
          ) : (
            <CaretDown
              className="text-white/15 transition-colors group-hover:text-white/35"
              size={14}
            />
          )}
        </div>
      </div>

      {/* Fork origin subtitle */}
      {fromSave && (
        <div
          className={cn(
            "-mt-1 pb-2.5 text-[11px]",
            isFocused ? "text-white/25" : "text-white/12"
          )}
          style={{ paddingLeft: `${lineLeft + 22}px` }}
        >
          forked from{" "}
          <span className="font-medium">{getSaveDisplayTitle(fromSave)}</span>
        </div>
      )}
    </button>
  );
}
