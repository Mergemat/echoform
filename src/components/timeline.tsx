import { useStore } from '@/lib/store';
import { sendDaemonCommand } from '@/lib/daemon-client';
import { useRef, useState, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  buildTimelineDisplayItems,
  getRootFileGroups,
  getRootIdeas,
  getRootIdeaFor,
  getIdeaSubtreeIds,
  fileTabName,
  type RootFileGroup,
} from './timeline-utils';
import { CollapsedCard } from './collapsed-card';
import { ExpandedCard } from './expanded-card';
import { GroupCard } from './save-group';
import { BranchSelector } from './branch-selector';
import { BranchCard } from './branch-card';
import type { Project } from '@/lib/types';

export function Timeline() {
  const project = useStore((s) => s.selectedProject());
  const selectedSaveId = useStore((s) => s.selectedSaveId);
  const activeIdeaId = useStore((s) => s.activeIdeaId);
  const collapsedBranches = useStore((s) => s.collapsedBranches);
  const toggleSave = useStore((s) => s.toggleSave);
  const setActiveIdea = useStore((s) => s.setActiveIdea);
  const toggleBranchCollapse = useStore((s) => s.toggleBranchCollapse);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Derive file tabs and active tab from project data
  const rootIdeas = useMemo(
    () => (project ? getRootIdeas(project) : []),
    [project],
  );
  const rootFileGroups = useMemo<RootFileGroup[]>(() => {
    return project ? getRootFileGroups(project) : [];
  }, [project]);
  const hasMultipleFiles = rootFileGroups.length > 1;

  const effectiveIdeaId = activeIdeaId ?? project?.currentIdeaId ?? null;
  const activeRootIdea = useMemo(() => {
    if (!project || !effectiveIdeaId) return rootIdeas[0] ?? null;
    return getRootIdeaFor(project, effectiveIdeaId) ?? rootIdeas[0] ?? null;
  }, [project, effectiveIdeaId, rootIdeas]);
  const activeRootGroup = useMemo(() => {
    if (rootFileGroups.length === 0) return null;
    if (!activeRootIdea) return rootFileGroups[0] ?? null;
    return (
      rootFileGroups.find(
        (group) => group.setPath === activeRootIdea.setPath,
      ) ??
      rootFileGroups[0] ??
      null
    );
  }, [activeRootIdea, rootFileGroups]);

  // Filter project to only ideas/saves under the active file tab
  const filteredProject = useMemo(() => {
    if (!project || !activeRootGroup) return project;
    if (!hasMultipleFiles) return project;
    const subtreeIds = new Set<string>();
    for (const rootIdea of activeRootGroup.rootIdeas) {
      for (const ideaId of getIdeaSubtreeIds(project, rootIdea.id)) {
        subtreeIds.add(ideaId);
      }
    }
    return {
      ...project,
      ideas: project.ideas.filter((i) => subtreeIds.has(i.id)),
      saves: project.saves.filter((s) => subtreeIds.has(s.ideaId)),
    };
  }, [project, activeRootGroup, hasMultipleFiles]);

  const displayItems = useMemo(() => {
    if (!filteredProject) return [];
    return buildTimelineDisplayItems(
      filteredProject,
      activeIdeaId,
      expandedGroups,
      collapsedBranches,
    );
  }, [filteredProject, activeIdeaId, expandedGroups, collapsedBranches]);

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => 56, []),
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

  const handleSelectIdea = useCallback(
    (ideaId: string) => {
      setActiveIdea(ideaId);
      if (!project) return;
      sendDaemonCommand({ type: 'open-idea', projectId: project.id, ideaId });
    },
    [project, setActiveIdea],
  );

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center px-6">
          <div className="text-[14px] text-white/20 font-medium">
            No project selected
          </div>
          <div className="mt-1 text-[12px] text-white/10">
            Select a project from the sidebar to see its timeline
          </div>
        </div>
      </div>
    );
  }

  if (project.saves.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center px-6">
          <div className="text-[14px] text-white/25 font-medium">
            No saves yet
          </div>
          <div className="mt-1 text-[12px] text-white/15 leading-relaxed">
            {project.presence === 'missing'
              ? 'Project folder is missing from watched roots'
              : project.watching
                ? 'Watching for changes...'
                : 'Enable watching to auto-save'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {hasMultipleFiles && project && (
        <FileTabs
          rootFileGroups={rootFileGroups}
          activeSetPath={activeRootGroup?.setPath ?? null}
          currentSetPath={
            getRootIdeaFor(project, project.currentIdeaId)?.setPath ?? null
          }
          project={project}
          onSelect={(ideaId) => {
            setActiveIdea(ideaId);
          }}
        />
      )}

      {filteredProject && filteredProject.ideas.length > 1 && (
        <BranchSelector
          project={filteredProject}
          activeIdeaId={activeIdeaId}
          onSelect={handleSelectIdea}
        />
      )}

      {project.pendingOpen && (
        <div className="px-4 py-2.5 border-b border-amber-400/10 bg-amber-400/[0.04]">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-amber-200/80 leading-relaxed">
              Could not open{' '}
              <span className="font-medium text-amber-200">
                {project.pendingOpen.setPath}
              </span>
              .
              {project.pendingOpen.error
                ? ` ${project.pendingOpen.error}`
                : ' Retry or reveal it in Finder.'}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  sendDaemonCommand({
                    type: 'open-idea',
                    projectId: project.id,
                    ideaId: project.pendingOpen!.ideaId,
                  })
                }
              >
                Open Again
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  sendDaemonCommand({
                    type: 'reveal-idea-file',
                    projectId: project.id,
                    ideaId: project.pendingOpen!.ideaId,
                  })
                }
              >
                Reveal
              </Button>
            </div>
          </div>
        </div>
      )}

      {project.driftStatus && (
        <div className="px-4 py-2.5 border-b border-red-400/10 bg-red-400/[0.04]">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-red-200/80 leading-relaxed">
              {project.driftStatus.kind === 'unknown-file'
                ? `Detected edits in untracked set ${project.driftStatus.setPath}.`
                : `Branch file ${project.driftStatus.setPath} is missing.`}
            </div>
            <div className="flex shrink-0 gap-1.5">
              {project.driftStatus.kind === 'unknown-file' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    sendDaemonCommand({
                      type: 'adopt-drift-file',
                      projectId: project.id,
                    })
                  }
                >
                  Adopt File
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  sendDaemonCommand({
                    type: 'open-idea',
                    projectId: project.id,
                    ideaId: project.currentIdeaId,
                  })
                }
              >
                Open Current Branch
              </Button>
            </div>
          </div>
        </div>
      )}

      {project.presence === 'missing' && (
        <div className="border-b border-amber-400/10 bg-amber-400/[0.04] px-4 py-2.5">
          <div className="text-[11px] text-amber-200/80 leading-relaxed">
            This project is missing from your watched folders. History stays
            safe here, but file actions are disabled until the folder comes back
            or the root is re-added.
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
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
                {item.type === 'branch' ? (
                  <BranchCard
                    idea={item.idea}
                    fromSave={item.fromSave}
                    depth={item.depth}
                    isCurrent={item.isCurrent}
                    isFocused={item.isFocused}
                    isCollapsed={item.isCollapsed}
                    saveCount={item.saveCount}
                    onToggleCollapse={() => toggleBranchCollapse(item.idea.id)}
                  />
                ) : item.type === 'group' ? (
                  <BranchLine depth={item.depth} isFocused={item.isFocused}>
                    <GroupCard
                      saves={item.saves}
                      groupKey={item.key}
                      expanded={expandedGroups.has(item.key)}
                      onToggle={() => toggleGroup(item.key)}
                    />
                  </BranchLine>
                ) : (
                  (() => {
                    const save = item.save;
                    const idea = item.idea;
                    const isHead = idea.headSaveId === save.id;
                    const isSelected = save.id === selectedSaveId;
                    if (isSelected) {
                      return (
                        <BranchLine
                          depth={item.depth}
                          isFocused={item.isFocused}
                        >
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
                        </BranchLine>
                      );
                    }
                    return (
                      <BranchLine depth={item.depth} isFocused={item.isFocused}>
                        <CollapsedCard
                          save={save}
                          isSelected={false}
                          isHead={isHead}
                          onClick={() => toggleSave(save.id)}
                        />
                      </BranchLine>
                    );
                  })()
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Horizontal file tabs — one per root .als file. Only shown when project has 2+ files. */
function FileTabs({
  rootFileGroups,
  activeSetPath,
  currentSetPath,
  project,
  onSelect,
}: {
  rootFileGroups: RootFileGroup[];
  activeSetPath: string | null;
  currentSetPath: string | null;
  project: Project;
  onSelect: (ideaId: string) => void;
}) {
  // Pre-compute subtree IDs and save counts per root idea
  const subtrees = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const group of rootFileGroups) {
      const subtree = new Set<string>();
      for (const idea of group.rootIdeas) {
        for (const ideaId of getIdeaSubtreeIds(project, idea.id)) {
          subtree.add(ideaId);
        }
      }
      map.set(group.setPath, subtree);
    }
    return map;
  }, [rootFileGroups, project]);

  return (
    <div className="flex items-center gap-0 border-b border-border px-3 overflow-x-auto shrink-0 scrollbar-none">
      {rootFileGroups.map((group) => {
        const idea = group.representativeIdea;
        const isActive = group.setPath === activeSetPath;
        const isCurrent = group.setPath === currentSetPath;
        const subtree = subtrees.get(group.setPath);
        const saveCount = subtree
          ? project.saves.filter((s) => subtree.has(s.ideaId)).length
          : 0;

        return (
          <button
            key={group.setPath}
            type="button"
            onClick={() => onSelect(idea.id)}
            className={cn(
              'relative flex items-center gap-1.5 px-3 py-2.5 text-[12px] whitespace-nowrap transition-colors duration-150',
              isActive ? 'text-white/85' : 'text-white/30 hover:text-white/50',
            )}
          >
            {isCurrent && (
              <span className="size-1.5 rounded-full bg-emerald-400/70 shrink-0" />
            )}
            <span className="font-medium">{fileTabName(idea)}</span>
            {saveCount > 0 && (
              <span className="text-[10px] text-white/20 tabular-nums">
                {saveCount}
              </span>
            )}
            {isActive && (
              <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-white/40" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Wrapper that draws a vertical branch line on the left side of save/group items */
function BranchLine({
  depth,
  isFocused,
  children,
}: {
  depth: number;
  isFocused: boolean;
  children: React.ReactNode;
}) {
  const lineLeft = 16 + depth * 20;

  return (
    <div className="relative">
      {/* Vertical branch line */}
      <div
        className="absolute top-0 bottom-0 w-px transition-colors duration-150"
        style={{
          left: `${lineLeft + 5}px`,
          backgroundColor: isFocused
            ? 'rgba(52, 211, 153, 0.2)'
            : 'rgba(255, 255, 255, 0.05)',
        }}
      />
      <div style={{ paddingLeft: `${lineLeft + 18}px` }}>{children}</div>
    </div>
  );
}
