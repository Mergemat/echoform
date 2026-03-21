import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Waveform } from '@phosphor-icons/react';
import { DiskUsagePanel } from '@/components/disk-usage-panel';

export function ProjectHeader() {
  const project = useStore((s) => s.selectedProject());

  if (!project) return null;

  const currentIdea = project.ideas.find((i) => i.id === project.currentIdeaId);
  const headSave = project.saves.find((s) => s.id === currentIdea?.headSaveId);

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
      <div className="flex items-center gap-3 min-w-0">
        <Waveform size={16} className="text-white/30 shrink-0" weight="bold" />
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium text-white/80 truncate">
            {project.name}
          </h2>
          <div className="flex items-center gap-1.5 text-[10px] text-white/25 mt-0.5">
            <span className="truncate font-mono">{project.activeSetPath}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5 text-[11px]">
          <div
            className={cn(
              'size-1.5 rounded-full',
              project.watching ? 'bg-emerald-400 animate-pulse' : 'bg-white/20',
            )}
          />
          <span
            className={cn(
              project.watching ? 'text-emerald-400/70' : 'text-white/25',
            )}
          >
            {project.watching ? 'Watching' : 'Paused'}
          </span>
        </div>
        {headSave && (
          <div className="text-[10px] text-white/20 font-mono">
            {headSave.metadata.fileCount} files
          </div>
        )}
        <DiskUsagePanel projectId={project.id} />
      </div>
    </div>
  );
}
