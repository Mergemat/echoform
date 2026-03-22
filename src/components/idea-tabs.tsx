import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function IdeaTabs({
  project,
  activeIdeaId,
  onSelect,
}: {
  project: Project;
  activeIdeaId: string | null;
  onSelect: (id: string) => void;
}) {
  const value = activeIdeaId ?? project.currentIdeaId;

  return (
    <div className="px-2 py-1.5 border-b border-white/[0.06] overflow-x-auto scrollbar-none shrink-0">
      <div className="text-[10px] uppercase tracking-[0.14em] text-white/20 px-1 pb-1.5">
        Branches
      </div>
      <Tabs value={value ?? ''} onValueChange={onSelect}>
        <TabsList variant="line" className="h-auto gap-0.5 p-0">
          {project.ideas.map((idea) => {
            const count = project.saves.filter(
              (s) => s.ideaId === idea.id,
            ).length;
            return (
              <TabsTrigger
                key={idea.id}
                value={idea.id}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] whitespace-nowrap h-auto',
                  'data-[state=active]:bg-white/[0.08] data-[state=active]:text-white/80',
                  'data-[state=inactive]:text-white/30 data-[state=inactive]:hover:text-white/50 data-[state=inactive]:hover:bg-white/[0.04]',
                  'after:hidden',
                )}
              >
                <span>{idea.parentIdeaId ? `↳ ${idea.name}` : idea.name}</span>
                <span
                  className={cn(
                    'text-[9px]',
                    value === idea.id ? 'text-white/30' : 'text-white/15',
                  )}
                >
                  {count}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </div>
  );
}
