import { CaretUpDown, Check, GitFork } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Idea, Project } from "@/lib/types";
import { cn } from "@/lib/utils";

function buildBranchTree(project: Project) {
  const ideasById = new Map(project.ideas.map((i) => [i.id, i]));
  const childrenByParent = new Map<string | null, Idea[]>();

  for (const idea of project.ideas) {
    const parentId = idea.parentIdeaId;
    const existing = childrenByParent.get(parentId) ?? [];
    existing.push(idea);
    childrenByParent.set(parentId, existing);
  }

  const result: { idea: Idea; depth: number; saveCount: number }[] = [];

  const visit = (parentId: string | null, depth: number) => {
    const children = childrenByParent.get(parentId) ?? [];
    for (const idea of children) {
      const saveCount = project.saves.filter(
        (s) => s.ideaId === idea.id
      ).length;
      result.push({ idea, depth, saveCount });
      visit(idea.id, depth + 1);
    }
  };

  // Root ideas: no parent or parent doesn't exist
  const rootIdeas = project.ideas.filter(
    (i) => !(i.parentIdeaId && ideasById.has(i.parentIdeaId))
  );
  for (const idea of rootIdeas) {
    const saveCount = project.saves.filter((s) => s.ideaId === idea.id).length;
    result.push({ idea, depth: 0, saveCount });
    visit(idea.id, 1);
  }

  return result;
}

export function BranchSelector({
  project,
  activeIdeaId,
  onSelect,
}: {
  project: Project;
  activeIdeaId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const focusedId = activeIdeaId ?? project.currentIdeaId;
  const focusedIdea = project.ideas.find((i) => i.id === focusedId);
  const branches = useMemo(() => buildBranchTree(project), [project]);

  return (
    <div className="shrink-0 border-border border-b px-3 py-2.5">
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            className="h-auto w-full justify-between rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
            variant="ghost"
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06]">
                <GitFork className="text-white/40" size={13} />
              </div>
              <div className="min-w-0">
                <span className="block truncate font-medium text-[13px] text-white/75">
                  {focusedIdea?.name ?? "Main"}
                </span>
                {focusedId === project.currentIdeaId && (
                  <span className="mt-0.5 block text-[10px] text-emerald-400/60 uppercase tracking-wider">
                    current
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
            Versions
          </div>
          <div className="px-2 pb-1.5 text-[11px] text-white/15 leading-snug">
            Each version is a separate .als file. Switch between them here.
          </div>
          <div className="scrollbar-thin max-h-[280px] overflow-y-auto">
            {branches.map(({ idea, depth, saveCount }) => {
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
                  style={{ paddingLeft: `${8 + depth * 16}px` }}
                  type="button"
                >
                  {depth > 0 && (
                    <span className="shrink-0 text-[10px] text-white/15">
                      &#x2514;
                    </span>
                  )}
                  <span className="flex-1 truncate text-[13px]">
                    {idea.name}
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
    </div>
  );
}
