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

/** One tab per .als file in the project; each has its own history. */
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
    <div className="flex flex-wrap gap-1">
      {sets.map(({ idea, saveCount }) => {
        const isActive = idea.id === focusedId;
        const isCurrent = idea.id === project.currentIdeaId;
        return (
          <button
            aria-pressed={isActive}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 font-medium text-[12px] transition-colors duration-100",
              isActive
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
            key={idea.id}
            onClick={() => onSelect(idea.id)}
            title={`${idea.setPath}${isCurrent ? " · saved most recently" : ""}`}
            type="button"
          >
            {isCurrent && <span className="size-1.5 rounded-full bg-success" />}
            {fileTabName(idea)}
            <span className="text-[11px] text-subtle-foreground tabular-nums">
              {saveCount}
            </span>
          </button>
        );
      })}
    </div>
  );
}
