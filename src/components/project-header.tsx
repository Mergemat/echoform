import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';
import { Waveform } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { DiskUsagePanel } from '@/components/disk-usage-panel';

function projectHealth(project: Project) {
  if (project.presence === 'missing') {
    return {
      label: 'Missing on disk',
      dotClass: 'bg-amber-400',
      textClass: 'text-amber-300/75',
    };
  }
  if (project.watchError) {
    return {
      label: 'Watcher error',
      dotClass: 'bg-red-400',
      textClass: 'text-red-300/75',
    };
  }
  if (!project.watching) {
    return {
      label: 'Paused',
      dotClass: 'bg-white/25',
      textClass: 'text-white/30',
    };
  }
  return {
    label: 'Watching',
    dotClass: 'bg-emerald-400 animate-pulse',
    textClass: 'text-emerald-300/75',
  };
}

export function ProjectHeader() {
  const project = useStore((state) => state.selectedProject());
  const send = useStore((state) => state.send);

  if (!project) return null;

  const currentIdea = project.ideas.find(
    (idea) => idea.id === project.currentIdeaId,
  );
  const pendingIdea = project.pendingOpen
    ? project.ideas.find((idea) => idea.id === project.pendingOpen?.ideaId)
    : null;
  const health = projectHealth(project);
  const canOpenFiles = project.presence === 'active';

  return (
    <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <Waveform size={16} className="shrink-0 text-white/30" weight="bold" />
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-medium text-white/80">
            {project.name}
          </h2>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/25">
            <span className={cn('size-1.5 rounded-full', health.dotClass)} />
            <span className={health.textClass}>{health.label}</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-white/35 hover:text-white/70"
            disabled={!canOpenFiles}
            onClick={() => {
              const targetIdeaId = pendingIdea?.id ?? currentIdea?.id;
              if (!targetIdeaId) return;
              send({
                type: 'open-idea',
                projectId: project.id,
                ideaId: targetIdeaId,
              });
            }}
          >
            Open
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-white/35 hover:text-white/70"
            disabled={!canOpenFiles}
            onClick={() => {
              const targetIdeaId = pendingIdea?.id ?? currentIdea?.id;
              if (!targetIdeaId) return;
              send({
                type: 'reveal-idea-file',
                projectId: project.id,
                ideaId: targetIdeaId,
              });
            }}
          >
            Reveal
          </Button>
        </div>

        <DiskUsagePanel projectId={project.id} />
      </div>
    </div>
  );
}
