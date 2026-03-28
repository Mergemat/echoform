import { useStore } from '@/lib/store';
import { sendDaemonCommand } from '@/lib/daemon-client';
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
      textClass: 'text-amber-400/70',
    };
  }
  if (project.watchError) {
    return {
      label: 'Watcher error',
      dotClass: 'bg-red-400',
      textClass: 'text-red-400/70',
    };
  }
  if (!project.watching) {
    return {
      label: 'Paused',
      dotClass: 'bg-white/20',
      textClass: 'text-white/25',
    };
  }
  return {
    label: 'Watching',
    dotClass: 'bg-emerald-400 animate-pulse',
    textClass: 'text-emerald-400/70',
  };
}

export function ProjectHeader() {
  const project = useStore((state) => state.selectedProject());

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
    <div className="flex items-center justify-between border-b border-border px-6 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-center justify-center size-10 rounded-lg bg-white/[0.04] shrink-0">
          <Waveform size={20} className="text-white/40" weight="bold" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-white/90 leading-tight">
            {project.name}
          </h2>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span
              className={cn('size-2 rounded-full shrink-0', health.dotClass)}
            />
            <span className={health.textClass}>{health.label}</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-white/50"
          disabled={!canOpenFiles}
          onClick={() => {
            const targetIdeaId = pendingIdea?.id ?? currentIdea?.id;
            if (!targetIdeaId) return;
            sendDaemonCommand({
              type: 'open-idea',
              projectId: project.id,
              ideaId: targetIdeaId,
            });
          }}
        >
          Open in Ableton
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-white/35 hover:text-white/60"
          disabled={!canOpenFiles}
          onClick={() => {
            const targetIdeaId = pendingIdea?.id ?? currentIdea?.id;
            if (!targetIdeaId) return;
            sendDaemonCommand({
              type: 'reveal-idea-file',
              projectId: project.id,
              ideaId: targetIdeaId,
            });
          }}
        >
          Reveal
        </Button>

        <div className="w-px h-5 bg-white/[0.06] mx-1" />

        <DiskUsagePanel projectId={project.id} />
      </div>
    </div>
  );
}
