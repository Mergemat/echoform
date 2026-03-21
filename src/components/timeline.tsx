import { useStore } from '@/lib/store';
import { useRef, useState, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { buildDisplayItems } from './timeline-utils';
import { CollapsedCard } from './collapsed-card';
import { ExpandedCard } from './expanded-card';
import { GroupCard } from './save-group';
import { IdeaTabs } from './idea-tabs';

export function Timeline() {
  const project = useStore((s) => s.selectedProject());
  const selectedSaveId = useStore((s) => s.selectedSaveId);
  const activeIdeaId = useStore((s) => s.activeIdeaId);
  const toggleSave = useStore((s) => s.toggleSave);
  const setActiveIdea = useStore((s) => s.setActiveIdea);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const effectiveIdeaId = activeIdeaId ?? project?.currentIdeaId ?? null;

  const filteredSaves = useMemo(() => {
    if (!project || !effectiveIdeaId) return [];
    return project.saves
      .filter((s) => s.ideaId === effectiveIdeaId)
      .slice()
      .reverse();
  }, [project, effectiveIdeaId]);

  const displayItems = useMemo(
    () => buildDisplayItems(filteredSaves, expandedGroups),
    [filteredSaves, expandedGroups],
  );

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => 60, []),
    overscan: 8,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center text-white/15 text-[13px]">
        Select a project to see its timeline
      </div>
    );
  }

  if (project.saves.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-white/20 text-[13px]">
        <div className="text-center">
          <div className="text-white/30 mb-1">No saves yet</div>
          <div className="text-[11px] text-white/15">
            {project.watching
              ? 'Watching for changes...'
              : 'Enable watching to auto-save'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <IdeaTabs
        project={project}
        activeIdeaId={activeIdeaId}
        onSelect={setActiveIdea}
      />

      {/* Vertical timeline line + cards */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[22px] top-0 bottom-0 w-px bg-white/[0.06]" />

          <div
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const item = displayItems[vItem.index]!;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  {item.type === 'group' ? (
                    <GroupCard
                      saves={item.saves}
                      groupKey={item.key}
                      expanded={expandedGroups.has(item.key)}
                      onToggle={() => toggleGroup(item.key)}
                    />
                  ) : (
                    (() => {
                      const save = item.save;
                      const idea = project.ideas.find(
                        (i) => i.id === save.ideaId,
                      );
                      const isHead = idea?.headSaveId === save.id;
                      const isSelected = save.id === selectedSaveId;
                      if (isSelected) {
                        return (
                          <div>
                            <CollapsedCard
                              save={save}
                              isSelected
                              isHead={isHead}
                              onClick={() => toggleSave(save.id)}
                            />
                            <ExpandedCard
                              save={save}
                              idea={idea}
                              isHead={isHead}
                              projectId={project.id}
                              onClose={() => toggleSave(save.id)}
                            />
                          </div>
                        );
                      }
                      return (
                        <CollapsedCard
                          save={save}
                          isSelected={false}
                          isHead={isHead}
                          onClick={() => toggleSave(save.id)}
                        />
                      );
                    })()
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
