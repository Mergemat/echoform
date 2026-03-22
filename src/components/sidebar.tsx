import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';
import { Eye, EyeSlash, MagnifyingGlass } from '@phosphor-icons/react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ProjectSearchCommand } from '@/components/project-search-command';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function ProjectItem({
  project,
  selected,
}: {
  project: Project;
  selected: boolean;
}) {
  const selectProject = useStore((s) => s.selectProject);
  const send = useStore((s) => s.send);
  const currentIdea = project.ideas.find((i) => i.id === project.currentIdeaId);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    selectProject(project.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => selectProject(project.id)}
      onKeyDown={handleKeyDown}
      className={cn(
        'group w-full text-left px-3 py-2.5 transition-colors rounded-md cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/15',
        selected
          ? 'bg-white/[0.08] text-white'
          : 'text-white/50 hover:text-white/70 hover:bg-white/[0.04]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium">{project.name}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                send({
                  type: 'toggle-watching',
                  projectId: project.id,
                  watching: !project.watching,
                });
              }}
              className={cn(
                'shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
                project.watching ? 'text-emerald-400' : 'text-white/30',
              )}
            >
              {project.watching ? <Eye size={14} /> : <EyeSlash size={14} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {project.watching ? 'Watching' : 'Not watching'}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-white/30">
        <span>{project.saves.length} saves</span>
        <span className="text-white/15">|</span>
        <span>{project.ideas.length} branches</span>
        <span className="text-white/15">|</span>
        <span>{currentIdea?.name ?? 'Main'}</span>
        {project.detachedRestore && (
          <>
            <span className="text-white/15">|</span>
            <span className="text-amber-200/60">restored</span>
          </>
        )}
        {project.saves.length > 0 && (
          <>
            <span className="text-white/15">|</span>
            <span>{formatSize(project.saves.at(-1)!.metadata.sizeBytes)}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function AppSidebar() {
  const projects = useStore((s) => s.projects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const [commandOpen, setCommandOpen] = useState(false);

  return (
    <TooltipProvider>
      {/* Sidebar panel — fills the width container set by App.tsx */}
      <div className="flex flex-col h-full w-full border-r border-white/[0.06] bg-white/[0.02] overflow-hidden">
        {/* Header */}
        <div className="px-3 pt-4 pb-3 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center justify-between">
            <h1 className="text-[15px] font-semibold text-white/90 tracking-tight">
              Ablegit
            </h1>
            <div className="flex gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setCommandOpen(true)}
                    className="text-white/30 hover:text-white/60"
                  >
                    <MagnifyingGlass size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Find &amp; add projects
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <p className="text-[11px] text-white/25 mt-1">
            auto-versioning for ableton
          </p>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto min-h-0 p-1.5 space-y-0.5">
          {projects.map((p) => (
            <ProjectItem
              key={p.id}
              project={p}
              selected={p.id === selectedProjectId}
            />
          ))}
          {projects.length === 0 && (
            <div className="px-3 py-8 text-center text-[12px] text-white/20">
              No projects tracked yet.
              <br />
              Click the search icon to find Ableton projects.
            </div>
          )}
        </div>
      </div>

      <ProjectSearchCommand open={commandOpen} onOpenChange={setCommandOpen} />
    </TooltipProvider>
  );
}
