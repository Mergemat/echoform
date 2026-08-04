import { useMemo } from "react";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fileTabName } from "./timeline-utils";

function getSets(project: Project) {
  return project.ideas
    .map((idea) => ({
      idea,
      saveCount: project.saves.filter((save) => save.ideaId === idea.id).length,
    }))
    .sort((a, b) => fileTabName(a.idea).localeCompare(fileTabName(b.idea)));
}

export function SetSelector({
  project,
  activeIdeaId,
  onSelect,
}: {
  project: Project;
  activeIdeaId: string | null;
  onSelect: (id: string) => void;
}) {
  const focusedId = activeIdeaId ?? project.currentIdeaId;
  const sets = useMemo(() => getSets(project), [project]);

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-wrap gap-2 px-8 pt-3 pb-5">
      {sets.map(({ idea, saveCount }) => {
        const isActive = idea.id === focusedId;
        const isCurrent = idea.id === project.currentIdeaId;
        return (
          <button
            aria-pressed={isActive}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-2 font-medium text-[12px] transition-[background-color,color] duration-100",
              isActive
                ? "bg-white/10 text-white"
                : "bg-white/[0.035] text-white/40 hover:bg-white/[0.06] hover:text-white/65"
            )}
            key={idea.id}
            onClick={() => onSelect(idea.id)}
            type="button"
          >
            {fileTabName(idea)}
            <span className="text-[10px] text-white/25 tabular-nums">
              {saveCount}
            </span>
            {isCurrent && (
              <span
                className="size-1.5 rounded-full bg-emerald-400"
                title="Current in Ableton"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
