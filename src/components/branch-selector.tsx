import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { Project, Idea } from '@/lib/types';
import { GitFork, CaretUpDown, Check } from '@phosphor-icons/react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

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
        (s) => s.ideaId === idea.id,
      ).length;
      result.push({ idea, depth, saveCount });
      visit(idea.id, depth + 1);
    }
  };

  // Root ideas: no parent or parent doesn't exist
  const rootIdeas = project.ideas.filter(
    (i) => !i.parentIdeaId || !ideasById.has(i.parentIdeaId),
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
    <div className="px-3 py-2.5 border-b border-border shrink-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between h-auto py-2 px-2.5 text-left rounded-lg hover:bg-white/[0.06] transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="size-6 rounded-md bg-white/[0.06] flex items-center justify-center shrink-0">
                <GitFork size={13} className="text-white/40" />
              </div>
              <div className="min-w-0">
                <span className="text-[12px] font-medium text-white/75 truncate block">
                  {focusedIdea?.name ?? 'Main'}
                </span>
                {focusedId === project.currentIdeaId && (
                  <span className="text-[9px] uppercase tracking-wider text-emerald-400/60 block mt-0.5">
                    current
                  </span>
                )}
              </div>
            </div>
            <CaretUpDown size={12} className="text-white/25 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-1.5"
        >
          <div className="text-[9px] uppercase tracking-[0.14em] text-white/25 font-medium px-2 py-1.5">
            Branches
          </div>
          <div className="max-h-[280px] overflow-y-auto scrollbar-thin">
            {branches.map(({ idea, depth, saveCount }) => {
              const isActive = idea.id === focusedId;
              const isCurrent = idea.id === project.currentIdeaId;
              return (
                <button
                  key={idea.id}
                  type="button"
                  onClick={() => {
                    onSelect(idea.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-left transition-colors',
                    isActive
                      ? 'bg-white/[0.08] text-white/90'
                      : 'text-white/50 hover:bg-white/[0.04] hover:text-white/70',
                  )}
                  style={{ paddingLeft: `${8 + depth * 16}px` }}
                >
                  {depth > 0 && (
                    <span className="text-white/15 text-[10px] shrink-0">
                      &#x2514;
                    </span>
                  )}
                  <span className="text-[12px] truncate flex-1">
                    {idea.name}
                  </span>
                  <span className="text-[10px] text-white/20 shrink-0 tabular-nums">
                    {saveCount}
                  </span>
                  {isCurrent && (
                    <div className="size-1.5 rounded-full bg-emerald-400/70 ring-2 ring-emerald-400/20 shrink-0" />
                  )}
                  {isActive && (
                    <Check
                      size={12}
                      className="text-white/40 shrink-0"
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
