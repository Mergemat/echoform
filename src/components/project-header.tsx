import { useStore } from '@/lib/store';
import { sendDaemonCommand } from '@/lib/daemon-client';
import { usePreviewStore } from '@/lib/preview-store';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';
import { Waveform, MusicNotes } from '@phosphor-icons/react';
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
  const togglePreviewSidebar = usePreviewStore(
    (state) => state.togglePreviewSidebar,
  );
  const previewSidebarOpen = usePreviewStore(
    (state) => state.previewSidebarOpen,
  );

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
    <div className="flex items-center justify-between border-b border-border px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-center justify-center size-8 rounded-lg bg-white/[0.04] shrink-0">
          <Waveform size={16} className="text-white/40" weight="bold" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold text-white/90 leading-tight">
            {project.name}
          </h2>
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            <span
              className={cn('size-1.5 rounded-full shrink-0', health.dotClass)}
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

        <div className="w-px h-4 bg-white/[0.06] mx-1" />

        <DiskUsagePanel projectId={project.id} />

        <Button
          type="button"
          variant={previewSidebarOpen ? 'outline' : 'ghost'}
          size="sm"
          className={cn(
            'text-[11px]',
            previewSidebarOpen
              ? 'text-white/70'
              : 'text-white/35 hover:text-white/60',
          )}
          onClick={togglePreviewSidebar}
        >
          <MusicNotes size={14} />
          Previews
        </Button>
      </div>
    </div>
  );
}
