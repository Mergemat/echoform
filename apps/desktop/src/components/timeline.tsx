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
  const [showPreviewsOnly, setShowPreviewsOnly] = useState(false);

  const effectiveIdeaId = activeIdeaId ?? project?.currentIdeaId ?? null;
  const selectedSave = project?.saves.find(
    (save) => save.id === selectedSaveId
  );
  const selectedIdea = selectedSave
    ? project?.ideas.find((idea) => idea.id === selectedSave.ideaId)
    : undefined;

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
      <div className="h-full overflow-y-auto px-8 py-8 pb-24">
        <div className="mx-auto max-w-[720px]">
          <MusicNotes className="text-white/20" size={24} weight="bold" />
          <h3 className="mt-6 max-w-[560px] text-balance font-semibold text-3xl text-white tracking-[-0.035em]">
            {isMissing
              ? "Reconnect this project to keep working with its history."
              : "Make the first checkpoint by saving in Ableton."}
          </h3>
          {isMissing ? (
            <div className="mt-4">
              <p className="max-w-[58ch] text-pretty text-[14px] text-white/40 leading-relaxed">
                This project's folder moved or is no longer available. Locate it
                to reconnect this history to the same project.
              </p>
              <div className="mt-6">
                <RelinkProjectButton projectId={project.id} />
              </div>
            </div>
          ) : isWatching ? (
            <div>
              <p className="mt-3 max-w-[58ch] text-pretty text-[14px] text-white/40 leading-relaxed">
                Echoform is already watching {project.name}. Open the set, work
                as usual, then save with{" "}
                <span className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[11px] text-white/40">
                  ⌘S
                </span>{" "}
                — its first restorable point will appear here.
              </p>
              <div className="mt-12 grid grid-cols-3 gap-3">
                {[
                  ["1", "Open the project"],
                  ["2", "Save with ⌘S"],
                  ["3", "Return to inspect changes"],
                ].map(([number, label]) => (
                  <div
                    className="rounded-2xl bg-white/[0.025] p-4 shadow-[0_0_0_1px_oklch(1_0_0/0.055)]"
                    key={number}
                  >
                    <div className="font-semibold text-[11px] text-emerald-300/70">
                      STEP {number}
                    </div>
                    <div className="mt-2 text-[13px] text-white/55">
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-3 max-w-[58ch] text-pretty text-[14px] text-white/35 leading-relaxed">
              Enable watching to start capturing saves whenever you work on this
              project.
            </p>
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
          onSelect={handleSelectIdea}
          project={project}
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
                onClick={() => {
                  posthog.capture("idea_opened_in_ableton", {
                    source: "pending_open_banner",
                  });
                  sendDaemonCommand({
                    ideaId: pendingOpen.ideaId,
                    projectId: project.id,
                    type: "open-idea",
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
                    ideaId: pendingOpen.ideaId,
                    projectId: project.id,
                    type: "reveal-idea-file",
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
                      projectId: project.id,
                      type: "adopt-drift-file",
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
                    ideaId: project.currentIdeaId,
                    projectId: project.id,
                    type: "open-idea",
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
        <div className="mx-auto flex w-full max-w-[980px] items-center gap-2 px-8 pb-3">
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

      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-thin min-w-0 flex-1 overflow-y-auto pb-24">
          {activeSetSaves.length === 0 && (
            <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-white/25">
              No checkpoints for this Ableton set yet.
            </div>
          )}
          {activeSetSaves.length > 0 && (
            <div
              className={cn(
                "mx-auto w-full px-8 pt-3",
                selectedSave ? "max-w-[720px]" : "max-w-[980px]"
              )}
            >
              <div className="mb-4 flex items-center gap-3">
                <h3 className="font-semibold text-[12px] text-white/45 uppercase tracking-[0.14em]">
                  Recent activity
                </h3>
                <div className="h-px flex-1 bg-white/[0.055]" />
              </div>
              <div className="space-y-2">
                {visibleItems.map((item) => {
                  if (item.type === "group") {
                    return (
                      <div key={`group-${item.key}`}>
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
                    <CollapsedCard
                      isHead={isHead}
                      isSelected={isSelected}
                      key={`save-${save.id}`}
                      onClick={() => toggleSave(save.id)}
                      project={project}
                      save={save}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {selectedSave && (
          <aside className="scrollbar-thin w-[min(48%,560px)] min-w-[420px] shrink-0 overflow-y-auto border-white/[0.065] border-s bg-[#101115]">
            <ExpandedCard
              idea={selectedIdea}
              isHead={selectedIdea?.headSaveId === selectedSave.id}
              onClose={() => toggleSave(selectedSave.id)}
              project={project}
              save={selectedSave}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
