import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';

export function IdeaTabs({
  project,
  activeIdeaId,
  onSelect,
}: {
  project: Project;
  activeIdeaId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.06] overflow-x-auto scrollbar-none shrink-0">
      {project.ideas.map((idea) => {
        const count = project.saves.filter((s) => s.ideaId === idea.id).length;
        const isActive = (activeIdeaId ?? project.currentIdeaId) === idea.id;
        return (
          <button
            key={idea.id}
            type="button"
            onClick={() => onSelect(idea.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] whitespace-nowrap transition-colors',
              isActive
                ? 'bg-white/[0.08] text-white/80'
                : 'text-white/30 hover:text-white/50 hover:bg-white/[0.04]',
            )}
          >
            <span>{idea.name}</span>
            <span
              className={cn(
                'text-[9px]',
                isActive ? 'text-white/30' : 'text-white/15',
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
