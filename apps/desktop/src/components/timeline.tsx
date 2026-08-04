import { MusicNotes, Waveform } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { posthog } from "@/lib/posthog";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { CollapsedCard } from "./collapsed-card";
import { ExpandedCard } from "./expanded-card";
import { RelinkProjectButton } from "./relink-project-button";
import { GroupCard } from "./save-group";
import { SetSelector } from "./set-selector";
import { buildTimelineDisplayItems } from "./timeline-utils";

export function Timeline() {
  return useTimelineView();
}

function useTimelineView() {
  const project = useStore((s) => s.selectedProject());
  const selectedSaveId = useStore((s) => s.selectedSaveId);
  const activeIdeaId = useStore((s) => s.activeIdeaId);
  const toggleSave = useStore((s) => s.toggleSave);
  const setActiveIdea = useStore((s) => s.setActiveIdea);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [ideaActionError, setIdeaActionError] = useState<string | null>(null);
  const [openingIdeaId, setOpeningIdeaId] = useState<string | null>(null);
  const [showPreviewsOnly, setShowPreviewsOnly] = useState(false);

  const effectiveIdeaId = activeIdeaId ?? project?.currentIdeaId ?? null;

  const displayItems = useMemo(() => {
    if (!project) {
      return [];
    }
    return buildTimelineDisplayItems(project, effectiveIdeaId, expandedGroups);
  }, [project, effectiveIdeaId, expandedGroups]);

  const activeSetSaves = useMemo(
    () =>
      project?.saves.filter((save) => save.ideaId === effectiveIdeaId) ?? [],
    [project, effectiveIdeaId]
  );
  const previewCount = useMemo(
    () =>
      activeSetSaves.filter(
        (s) => s.previewStatus === "ready" && s.previewRefs.length > 0
      ).length,
    [activeSetSaves]
  );
  const previewSaveIds = useMemo(() => {
    if (!(showPreviewsOnly && previewCount > 0)) {
      return null;
    }
    return new Set(
      activeSetSaves
        .filter((s) => s.previewStatus === "ready" && s.previewRefs.length > 0)
        .map((s) => s.id)
    );
  }, [activeSetSaves, previewCount, showPreviewsOnly]);

  const visibleItems = useMemo(() => {
    if (!previewSaveIds) {
      return displayItems;
    }
    return displayItems.filter((item) => {
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
    },
    [setActiveIdea]
  );

  const handleOpenIdea = useCallback(
    async (ideaId: string) => {
      if (!project) {
        return;
      }
      setIdeaActionError(null);
      setOpeningIdeaId(ideaId);
      try {
        await sendDaemonCommand(
          {
            type: "open-idea",
            projectId: project.id,
            ideaId,
          },
          { reportError: false }
        );
        posthog.capture("idea_opened_in_ableton", { source: "timeline" });
      } catch (error) {
        setIdeaActionError(
          error instanceof Error
            ? error.message
            : "The set could not be opened."
        );
      } finally {
        setOpeningIdeaId(null);
      }
    },
    [project]
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
            Pick a project from the sidebar to see its checkpoint timeline
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
            {isMissing ? "Project not found" : "No checkpoints yet"}
          </div>
          {isMissing ? (
            <div className="flex flex-col items-center gap-3">
              <div className="max-w-[280px] text-[13px] text-white/30 leading-relaxed">
                This project's folder moved or is no longer available. Locate it
                to reconnect this history to the same project.
              </div>
              <RelinkProjectButton projectId={project.id} />
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
      {project.ideas.length > 0 && (
        <SetSelector
          activeIdeaId={activeIdeaId}
          onOpenInAbleton={(ideaId) => void handleOpenIdea(ideaId)}
          onSelect={handleSelectIdea}
          openDisabled={project.presence === "missing"}
          openingIdeaId={openingIdeaId}
          project={project}
        />
      )}

      {ideaActionError && (
        <div
          className="border-red-300/15 border-b bg-red-300/[0.06] px-5 py-2 text-red-200/85 text-xs"
          role="alert"
        >
          {ideaActionError}
        </div>
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
                onClick={() => {
                  posthog.capture("idea_opened_in_ableton", {
                    source: "pending_open_banner",
                  });
                  sendDaemonCommand({
                    type: "open-idea",
                    projectId: project.id,
                    ideaId: pendingOpen.ideaId,
                  });
                }}
                size="sm"
                variant="ghost"
              >
                Open Again
              </Button>
              <Button
                onClick={() => {
                  posthog.capture("idea_revealed_in_finder", {
                    source: "pending_open_banner",
                  });
                  sendDaemonCommand({
                    type: "reveal-idea-file",
                    projectId: project.id,
                    ideaId: pendingOpen.ideaId,
                  });
                }}
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
                : `Ableton set ${project.driftStatus.setPath} is missing.`}
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
                onClick={() => {
                  posthog.capture("idea_opened_in_ableton", {
                    source: "drift_banner",
                  });
                  sendDaemonCommand({
                    type: "open-idea",
                    projectId: project.id,
                    ideaId: project.currentIdeaId,
                  });
                }}
                size="sm"
                variant="ghost"
              >
                Open Current Set
              </Button>
            </div>
          </div>
        </div>
      )}

      {project.presence === "missing" && (
        <div className="border-amber-400/10 border-b bg-amber-400/[0.04] px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-amber-200/80 text-xs leading-relaxed">
              This project's folder moved or is unavailable. History stays safe;
              locate the project to restore file actions without creating a new
              history.
            </div>
            <RelinkProjectButton projectId={project.id} />
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
        {activeSetSaves.length === 0 && (
          <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-white/25">
            No checkpoints for this Ableton set yet.
          </div>
        )}
        {visibleItems.map((item) => {
          if (item.type === "group") {
            return (
              <div className="px-4" key={`group-${item.key}`}>
                <GroupCard
                  expanded={expandedGroups.has(item.key)}
                  groupKey={item.key}
                  onToggle={() => toggleGroup(item.key)}
                  saves={item.saves}
                />
              </div>
            );
          }

          const save = item.save;
          const idea = item.idea;
          const isHead = idea.headSaveId === save.id;
          const isSelected = save.id === selectedSaveId;

          return (
            <div className="px-4" key={`save-${save.id}`}>
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
