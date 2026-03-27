import { useMemo } from 'react';
import { usePreviewStore } from '@/lib/preview-store';
import { SpeakerHigh, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import type { Project, Save, Idea } from '@/lib/types';
import { cn } from '@/lib/utils';

function PreviewItem({
  save,
  idea,
  isPlaying,
  onClick,
}: {
  save: Save;
  idea: Idea | undefined;
  isPlaying: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-lg transition-colors group',
        isPlaying
          ? 'bg-white/[0.08] text-white/90'
          : 'text-white/55 hover:bg-white/[0.04] hover:text-white/75',
      )}
    >
      <div className="flex items-center gap-2">
        <SpeakerHigh
          size={12}
          weight="fill"
          className={cn(
            'shrink-0 transition-colors',
            isPlaying
              ? 'text-white/60'
              : 'text-white/20 group-hover:text-white/35',
          )}
        />
        <span className="text-[13px] font-medium truncate">{save.label}</span>
      </div>
      {idea && (
        <div className="text-[11px] text-white/25 truncate mt-0.5 pl-5">
          {idea.name}
        </div>
      )}
    </button>
  );
}

function groupByIdea(project: Project) {
  const readySaves = project.saves.filter(
    (s) => s.previewStatus === 'ready' && s.previewRefs.length > 0,
  );

  const groups = new Map<string, { idea: Idea | undefined; saves: Save[] }>();

  for (const save of readySaves) {
    const idea = project.ideas.find((i) => i.id === save.ideaId);
    const key = save.ideaId;
    const existing = groups.get(key);
    if (existing) {
      existing.saves.push(save);
    } else {
      groups.set(key, { idea, saves: [save] });
    }
  }

  // Sort saves within each group newest first
  for (const group of groups.values()) {
    group.saves.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return [...groups.values()];
}

export function PreviewSidebar({ project }: { project: Project }) {
  const openPreviewPlayer = usePreviewStore((s) => s.openPreviewPlayer);
  const previewPlayerSaveId = usePreviewStore((s) => s.previewPlayerSaveId);
  const togglePreviewSidebar = usePreviewStore((s) => s.togglePreviewSidebar);

  const groups = useMemo(() => groupByIdea(project), [project]);
  const totalCount = groups.reduce((sum, g) => sum + g.saves.length, 0);

  if (totalCount === 0) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden border-l border-border bg-white/[0.015]">
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-3">
          <div className="text-[13px] font-semibold text-white/70">
            Previews
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={togglePreviewSidebar}
            className="text-white/20 hover:text-white/50"
          >
            <X size={12} />
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center px-6">
          <p className="text-xs text-white/20 text-center leading-relaxed">
            No previews yet. Add one from the save detail panel.
          </p>
        </div>
      </div>
    );
  }

  const singleGroup = groups.length === 1;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-border bg-white/[0.015]">
      <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-white/70">
            Previews
          </span>
          <span className="text-[11px] text-white/25 tabular-nums">
            {totalCount}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={togglePreviewSidebar}
          className="text-white/20 hover:text-white/50"
        >
          <X size={12} />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-2 pb-3 space-y-3">
        {groups.map(({ idea, saves }) => (
          <div key={idea?.id ?? 'unknown'}>
            {!singleGroup && (
              <div className="text-[11px] text-white/25 uppercase tracking-wider font-medium px-3 mb-1">
                {idea?.name ?? 'Unknown'}
              </div>
            )}
            <div className="space-y-0.5">
              {saves.map((save) => (
                <PreviewItem
                  key={save.id}
                  save={save}
                  idea={singleGroup ? undefined : idea}
                  isPlaying={previewPlayerSaveId === save.id}
                  onClick={() => openPreviewPlayer(save.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
