import { GitFork, MusicNotes, Waveform } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BranchCard } from "./branch-card";
import { BranchSelector } from "./branch-selector";
import { CollapsedCard } from "./collapsed-card";
import { ExpandedCard } from "./expanded-card";
import { GroupCard } from "./save-group";
import {
  buildTimelineDisplayItems,
  fileTabName,
  getIdeaSubtreeIds,
  getRootFileGroups,
  getRootIdeaFor,
  getRootIdeas,
  type RootFileGroup,
} from "./timeline-utils";

export function Timeline() {
  return useTimelineView();
}

function useTimelineView() {
  const project = useStore((s) => s.selectedProject());
  const selectedSaveId = useStore((s) => s.selectedSaveId);
  const activeIdeaId = useStore((s) => s.activeIdeaId);
  const collapsedBranches = useStore((s) => s.collapsedBranches);
  const toggleSave = useStore((s) => s.toggleSave);
  const setActiveIdea = useStore((s) => s.setActiveIdea);
  const toggleBranchCollapse = useStore((s) => s.toggleBranchCollapse);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showPreviewsOnly, setShowPreviewsOnly] = useState(false);

  // Derive file tabs and active tab from project data
  const rootIdeas = useMemo(
    () => (project ? getRootIdeas(project) : []),
    [project]
  );
  const rootFileGroups = useMemo<RootFileGroup[]>(() => {
    return project ? getRootFileGroups(project) : [];
  }, [project]);
  const hasMultipleFiles = rootFileGroups.length > 1;

  const effectiveIdeaId = activeIdeaId ?? project?.currentIdeaId ?? null;
  const activeRootIdea = useMemo(() => {
    if (!(project && effectiveIdeaId)) {
      return rootIdeas[0] ?? null;
    }
    return getRootIdeaFor(project, effectiveIdeaId) ?? rootIdeas[0] ?? null;
  }, [project, effectiveIdeaId, rootIdeas]);
  const activeRootGroup = useMemo(() => {
    if (rootFileGroups.length === 0) {
      return null;
    }
    if (!activeRootIdea) {
      return rootFileGroups[0] ?? null;
    }
    return (
      rootFileGroups.find(
        (group) => group.setPath === activeRootIdea.setPath
      ) ??
      rootFileGroups[0] ??
      null
    );
  }, [activeRootIdea, rootFileGroups]);

  // Filter project to only ideas/saves under the active file tab
  const filteredProject = useMemo(() => {
    if (!(project && activeRootGroup)) {
      return project;
    }
    if (!hasMultipleFiles) {
      return project;
    }
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
    if (!filteredProject) {
      return [];
    }
    return buildTimelineDisplayItems(
      filteredProject,
      activeIdeaId,
      expandedGroups,
      collapsedBranches
    );
  }, [filteredProject, activeIdeaId, expandedGroups, collapsedBranches]);

  const previewCount = useMemo(
    () =>
      project?.saves.filter(
        (s) => s.previewStatus === "ready" && s.previewRefs.length > 0
      ).length ?? 0,
    [project]
  );
  const previewSaveIds = useMemo(() => {
    if (!showPreviewsOnly) {
      return null;
    }
    return new Set(
      project?.saves
        .filter((s) => s.previewStatus === "ready" && s.previewRefs.length > 0)
        .map((s) => s.id) ?? []
    );
  }, [project, showPreviewsOnly]);

  const visibleItems = useMemo(() => {
    if (!previewSaveIds) {
      return displayItems;
    }
    return displayItems.filter((item) => {
      if (item.type === "branch") {
        return true;
      }
      if (item.type === "save") {
        return previewSaveIds.has(item.save.id);
      }
      if (item.type === "group") {
        return item.saves.some((s) => previewSaveIds.has(s.id));
      }
      return true;
    });
  }, [displayItems, previewSaveIds]);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleSelectIdea = useCallback(
    (ideaId: string) => {
      setActiveIdea(ideaId);
      if (!project) {
        return;
      }
      sendDaemonCommand({ type: "open-idea", projectId: project.id, ideaId });
    },
    [project, setActiveIdea]
  );

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-white/[0.04]">
            <Waveform className="text-white/15" size={22} weight="bold" />
          </div>
          <div className="font-medium text-[15px] text-white/25">
            No project selected
          </div>
          <div className="max-w-[240px] text-[13px] text-white/15 leading-relaxed">
            Pick a project from the sidebar to see its version timeline
          </div>
        </div>
      </div>
    );
  }

  if (project.saves.length === 0) {
    const isMissing = project.presence === "missing";
    const isWatching = project.watching && !isMissing;

    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-white/[0.04]">
            <MusicNotes className="text-white/15" size={22} weight="bold" />
          </div>
          <div className="font-medium text-[15px] text-white/25">
            {isMissing ? "Project not found" : "No saves yet"}
          </div>
          {isMissing ? (
            <div className="max-w-[280px] text-[13px] text-white/15 leading-relaxed">
              This project's folder is missing from your watched roots.
            </div>
          ) : isWatching ? (
            <div className="flex flex-col items-center gap-3">
              <div className="max-w-[260px] text-[13px] text-white/30 leading-relaxed">
                Open this project in Ableton and hit{" "}
                <span className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[11px] text-white/40">
                  ⌘S
                </span>{" "}
                — Echoform will capture the save automatically.
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/50">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400/60" />
                Listening for changes
              </div>
            </div>
          ) : (
            <div className="max-w-[280px] text-[13px] text-white/15 leading-relaxed">
              Enable watching to start capturing saves whenever you work on this
              project.
            </div>
          )}
        </div>
      </div>
    );
  }

  const pendingOpen = project.pendingOpen;

  return (
    <div className="flex h-full flex-col">
      {hasMultipleFiles && project && (
        <FileTabs
          activeSetPath={activeRootGroup?.setPath ?? null}
          currentSetPath={
            getRootIdeaFor(project, project.currentIdeaId)?.setPath ?? null
          }
          onSelect={(ideaId) => {
            setActiveIdea(ideaId);
          }}
          project={project}
          rootFileGroups={rootFileGroups}
        />
      )}

      {filteredProject && filteredProject.ideas.length > 1 && (
        <BranchSelector
          activeIdeaId={activeIdeaId}
          onSelect={handleSelectIdea}
          project={filteredProject}
        />
      )}

      {pendingOpen && (
        <div className="border-amber-400/10 border-b bg-amber-400/[0.04] px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-amber-200/80 text-xs leading-relaxed">
              Could not open{" "}
              <span className="font-medium text-amber-200">
                {pendingOpen.setPath}
              </span>
              .
              {pendingOpen.error
                ? ` ${pendingOpen.error}`
                : " Retry or reveal it in Finder."}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                onClick={() =>
                  sendDaemonCommand({
                    type: "open-idea",
                    projectId: project.id,
                    ideaId: pendingOpen.ideaId,
                  })
                }
                size="sm"
                variant="ghost"
              >
                Open Again
              </Button>
              <Button
                onClick={() =>
                  sendDaemonCommand({
                    type: "reveal-idea-file",
                    projectId: project.id,
                    ideaId: pendingOpen.ideaId,
                  })
                }
                size="sm"
                variant="ghost"
              >
                Reveal
              </Button>
            </div>
          </div>
        </div>
      )}

      {project.driftStatus && (
        <div className="border-red-400/10 border-b bg-red-400/[0.04] px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-red-200/80 text-xs leading-relaxed">
              {project.driftStatus.kind === "unknown-file"
                ? `Detected edits in untracked set ${project.driftStatus.setPath}.`
                : `Version file ${project.driftStatus.setPath} is missing.`}
            </div>
            <div className="flex shrink-0 gap-1.5">
              {project.driftStatus.kind === "unknown-file" && (
                <Button
                  onClick={() =>
                    sendDaemonCommand({
                      type: "adopt-drift-file",
                      projectId: project.id,
                    })
                  }
                  size="sm"
                  variant="ghost"
                >
                  Adopt File
                </Button>
              )}
              <Button
                onClick={() =>
                  sendDaemonCommand({
                    type: "open-idea",
                    projectId: project.id,
                    ideaId: project.currentIdeaId,
                  })
                }
                size="sm"
                variant="ghost"
              >
                Open Current Version
              </Button>
            </div>
          </div>
        </div>
      )}

      {project.presence === "missing" && (
        <div className="border-amber-400/10 border-b bg-amber-400/[0.04] px-5 py-3">
          <div className="text-amber-200/80 text-xs leading-relaxed">
            This project is missing from your watched folders. History stays
            safe here, but file actions are disabled until the folder comes back
            or the root is re-added.
          </div>
        </div>
      )}

      {previewCount > 0 && (
        <div className="flex items-center gap-2 border-border border-b px-5 py-2">
          <Button
            className={cn(
              "gap-1.5 text-xs",
              showPreviewsOnly
                ? "text-white/70"
                : "text-white/30 hover:text-white/50"
            )}
            onClick={() => setShowPreviewsOnly((v) => !v)}
            size="sm"
            type="button"
            variant={showPreviewsOnly ? "outline" : "ghost"}
          >
            <MusicNotes size={13} />
            Previews
            <span className="text-[10px] text-white/20 tabular-nums">
              {previewCount}
            </span>
          </Button>
        </div>
      )}

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {visibleItems.map((item) => {
          if (item.type === "branch") {
            return (
              <BranchCard
                depth={item.depth}
                fromSave={item.fromSave}
                idea={item.idea}
                isCollapsed={item.isCollapsed}
                isCurrent={item.isCurrent}
                isFocused={item.isFocused}
                key={`branch-${item.idea.id}`}
                onToggleCollapse={() => toggleBranchCollapse(item.idea.id)}
                saveCount={item.saveCount}
              />
            );
          }

          if (item.type === "group") {
            return (
              <BranchLine
                depth={item.depth}
                isFocused={item.isFocused}
                key={`group-${item.key}`}
              >
                <GroupCard
                  expanded={expandedGroups.has(item.key)}
                  groupKey={item.key}
                  onToggle={() => toggleGroup(item.key)}
                  saves={item.saves}
                />
              </BranchLine>
            );
          }

          const save = item.save;
          const idea = item.idea;
          const isHead = idea.headSaveId === save.id;
          const isSelected = save.id === selectedSaveId;

          return (
            <BranchLine
              depth={item.depth}
              isFocused={item.isFocused}
              key={`save-${save.id}`}
            >
              {isSelected ? (
                <div>
                  <CollapsedCard
                    isHead={isHead}
                    isSelected
                    onClick={() => toggleSave(save.id)}
                    project={project}
                    save={save}
                  />
                  <ExpandedCard
                    idea={idea}
                    isHead={isHead}
                    onClose={() => toggleSave(save.id)}
                    project={project}
                    save={save}
                  />
                </div>
              ) : (
                <CollapsedCard
                  isHead={isHead}
                  isSelected={false}
                  onClick={() => toggleSave(save.id)}
                  project={project}
                  save={save}
                />
              )}
            </BranchLine>
          );
        })}
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
    <div className="scrollbar-none flex shrink-0 items-center gap-0 overflow-x-auto border-border border-b px-3">
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
            className={cn(
              "relative flex items-center gap-1.5 whitespace-nowrap px-4 py-3 text-[13px] transition-colors duration-150",
              isActive ? "text-white/85" : "text-white/30 hover:text-white/50"
            )}
            key={group.setPath}
            onClick={() => onSelect(idea.id)}
            type="button"
          >
            {isCurrent && (
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-400/70" />
            )}
            <span className="font-medium">{fileTabName(idea)}</span>
            {group.forkedFromSetPath && (
              <span className="flex items-center gap-0.5 text-[11px] text-white/20">
                <GitFork className="size-3" weight="bold" />
                {group.forkedFromIdeaName}
              </span>
            )}
            {saveCount > 0 && (
              <span className="text-[11px] text-white/20 tabular-nums">
                {saveCount}
              </span>
            )}
            {isActive && (
              <span className="absolute right-3 bottom-0 left-3 h-[2px] rounded-full bg-white/40" />
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
            ? "rgba(52, 211, 153, 0.2)"
            : "rgba(255, 255, 255, 0.05)",
        }}
      />
      <div style={{ paddingLeft: `${lineLeft + 18}px` }}>{children}</div>
    </div>
  );
}
