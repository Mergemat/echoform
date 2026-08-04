import { CaretUpDown, Check, Files } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  openDisabled = false,
  openingIdeaId = null,
  onOpenInAbleton,
  onSelect,
}: {
  project: Project;
  activeIdeaId: string | null;
  openDisabled?: boolean;
  openingIdeaId?: string | null;
  onOpenInAbleton: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const focusedId = activeIdeaId ?? project.currentIdeaId;
  const focusedIdea = project.ideas.find((idea) => idea.id === focusedId);
  const sets = useMemo(() => getSets(project), [project]);

  return (
    <div className="shrink-0 border-border border-b px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger asChild>
            <Button
              className="h-auto min-w-0 flex-1 justify-between rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
              variant="ghost"
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06]">
                  <Files className="text-white/40" size={13} />
                </div>
                <div className="min-w-0">
                  <span className="block truncate font-medium text-[13px] text-white/75">
                    Ableton set:{" "}
                    {focusedIdea ? fileTabName(focusedIdea) : "Main"}
                  </span>
                  {focusedId === project.currentIdeaId && (
                    <span className="mt-0.5 block text-[10px] text-emerald-400/60 uppercase tracking-wider">
                      current in Ableton
                    </span>
                  )}
                </div>
              </div>
              <CaretUpDown className="shrink-0 text-white/25" size={12} />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[var(--radix-popover-trigger-width)] p-1.5"
          >
            <div className="px-2 py-1.5 font-medium text-[10px] text-white/25 uppercase tracking-[0.14em]">
              Ableton sets
            </div>
            <div className="px-2 pb-1.5 text-[11px] text-white/15 leading-snug">
              Choose which set's checkpoints to inspect. This does not switch
              the file open in Ableton.
            </div>
            <div className="scrollbar-thin max-h-[280px] overflow-y-auto">
              {sets.map(({ idea, saveCount }) => {
                const isActive = idea.id === focusedId;
                const isCurrent = idea.id === project.currentIdeaId;
                return (
                  <button
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                      isActive
                        ? "bg-white/[0.08] text-white/90"
                        : "text-white/50 hover:bg-white/[0.04] hover:text-white/70"
                    )}
                    key={idea.id}
                    onClick={() => {
                      onSelect(idea.id);
                      setOpen(false);
                    }}
                    type="button"
                  >
                    <span className="flex-1 truncate text-[13px]">
                      {fileTabName(idea)}
                    </span>
                    <span className="shrink-0 text-[10px] text-white/20 tabular-nums">
                      {saveCount}
                    </span>
                    {isCurrent && (
                      <div className="size-1.5 shrink-0 rounded-full bg-emerald-400/70 ring-2 ring-emerald-400/20" />
                    )}
                    {isActive && (
                      <Check
                        className="shrink-0 text-white/40"
                        size={12}
                        weight="bold"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
        <Button
          disabled={openDisabled || !focusedIdea || openingIdeaId !== null}
          onClick={() => focusedIdea && onOpenInAbleton(focusedIdea.id)}
          size="sm"
          type="button"
          variant="outline"
        >
          {openingIdeaId === focusedId ? "Opening..." : "Open in Ableton"}
        </Button>
      </div>
    </div>
  );
}
