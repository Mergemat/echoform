import { MagnifyingGlass, MusicNotes, Warning } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { posthog } from "@/lib/posthog";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CheckpointDetail } from "./checkpoint-detail";
import { CheckpointGroupRow } from "./checkpoint-group-row";
import { CheckpointRow, matchesSearch } from "./checkpoint-row";
import { RelinkProjectButton } from "./relink-project-button";
import { SetSelector } from "./set-selector";
import {
  buildTimelineSections,
  type DisplayItem,
  type TimelineSection,
} from "./timeline-utils";

function hasPreview(save: Project["saves"][number]) {
  return save.previewStatus === "ready" && save.previewRefs.length > 0;
}

function Banner({
  tone,
  children,
  actions,
}: {
  tone: "warning" | "error";
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b px-8 py-3 text-[12px] leading-relaxed",
        tone === "warning"
          ? "border-warning/20 bg-warning/10 text-warning"
          : "border-destructive/20 bg-destructive/10 text-destructive"
      )}
      role="status"
    >
      <div className="flex items-start gap-2">
        <Warning className="mt-0.5 shrink-0" size={14} />
        <div>{children}</div>
      </div>
      {actions && <div className="flex shrink-0 gap-1.5">{actions}</div>}
    </div>
  );
}

function ProjectBanners({ project }: { project: Project }) {
  const pendingOpen = project.pendingOpen;
  const drift = project.driftStatus;

  return (
    <>
      {pendingOpen && (
        <Banner
          actions={
            <>
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
                size="xs"
                variant="secondary"
              >
                Try again
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
                size="xs"
                variant="ghost"
              >
                Show in Finder
              </Button>
            </>
          }
          tone="warning"
        >
          Ableton didn't open <strong>{pendingOpen.setPath}</strong>.
          {pendingOpen.error ? ` ${pendingOpen.error}` : ""}
        </Banner>
      )}

      {drift && (
        <Banner
          actions={
            drift.kind === "unknown-file" ? (
              <Button
                onClick={() =>
                  sendDaemonCommand({
                    projectId: project.id,
                    type: "adopt-drift-file",
                  })
                }
                size="xs"
                variant="secondary"
              >
                Track this set
              </Button>
            ) : undefined
          }
          tone="error"
        >
          {drift.kind === "unknown-file" ? (
            <>
              <strong>{drift.setPath}</strong> was saved, but Echoform isn't
              tracking it yet, so that save wasn't recorded.
            </>
          ) : (
            <>
              <strong>{drift.setPath}</strong> is missing from the project
              folder. Its history is still safe here.
            </>
          )}
        </Banner>
      )}
    </>
  );
}

function EmptyHistory({ project }: { project: Project }) {
  if (project.presence === "missing") {
    return (
      <div className="mx-auto max-w-[520px] px-8 py-16">
        <h2 className="font-semibold text-[18px]">
          This project's folder can't be found
        </h2>
        <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
          It was moved, renamed, or is on a drive that isn't connected. Locate
          it to reconnect this project to its history.
        </p>
        <div className="mt-5">
          <RelinkProjectButton projectId={project.id} />
        </div>
      </div>
    );
  }

  if (!project.watching) {
    return (
      <div className="mx-auto max-w-[520px] px-8 py-16">
        <h2 className="font-semibold text-[18px]">Recording is paused</h2>
        <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
          Resume recording above, then save in Ableton to create the first
          checkpoint.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[520px] px-8 py-16">
      <MusicNotes className="text-muted-foreground" size={22} />
      <h2 className="mt-4 font-semibold text-[18px]">
        Save in Ableton to create the first checkpoint
      </h2>
      <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
        Echoform is watching this project. Each time you press{" "}
        <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
          ⌘S
        </kbd>{" "}
        in Ableton, it stores a full copy of the project here. You can come back
        to any of them later without touching your current work.
      </p>
    </div>
  );
}

function TimelineSectionView({
  section,
  project,
  selectedSaveId,
  query,
  onToggleSave,
  onToggleGroup,
}: {
  section: TimelineSection;
  project: Project;
  query: string;
  selectedSaveId: string | null;
  onToggleSave: (id: string) => void;
  onToggleGroup: (key: string) => void;
}) {
  const renderItem = (item: DisplayItem) => {
    if (item.type === "group") {
      return (
        <CheckpointGroupRow
          expanded={item.expanded}
          key={`group-${item.key}`}
          onToggle={() => onToggleGroup(item.key)}
          saves={item.saves}
        />
      );
    }
    const { save } = item;
    return (
      <CheckpointRow
        indented={item.grouped}
        isHead={project.ideas.some((idea) => idea.headSaveId === save.id)}
        isSelected={save.id === selectedSaveId}
        key={`save-${save.id}`}
        onClick={() => onToggleSave(save.id)}
        project={project}
        query={query}
        save={save}
      />
    );
  };

  const saveCount = section.items.reduce(
    (sum, item) => sum + (item.type === "group" ? item.saves.length : 1),
    0
  );

  return (
    <section>
      <h3 className="flex items-baseline gap-3 pt-6 pb-2 pl-3">
        <span className="font-semibold text-[20px] text-foreground tracking-tight">
          {section.label}
        </span>
        <span className="text-[12px] text-subtle-foreground">
          {saveCount} {saveCount === 1 ? "save" : "saves"}
        </span>
      </h3>
      <div>{section.items.map(renderItem)}</div>
    </section>
  );
}

export function Timeline() {
  const project = useStore((s) => s.selectedProject());
  const projectCount = useStore((s) => s.projects.length);
  const selectedSaveId = useStore((s) => s.selectedSaveId);
  const activeIdeaId = useStore((s) => s.activeIdeaId);
  const toggleSave = useStore((s) => s.toggleSave);
  const setActiveIdea = useStore((s) => s.setActiveIdea);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showPreviewsOnly, setShowPreviewsOnly] = useState(false);
  const [query, setQuery] = useState("");

  const effectiveIdeaId = activeIdeaId ?? project?.currentIdeaId ?? null;
  const selectedSave = project?.saves.find(
    (save) => save.id === selectedSaveId
  );
  const selectedIdea = selectedSave
    ? project?.ideas.find((idea) => idea.id === selectedSave.ideaId)
    : undefined;

  const sections = useMemo(
    () =>
      project
        ? buildTimelineSections(project, effectiveIdeaId, expandedGroups)
        : [],
    [project, effectiveIdeaId, expandedGroups]
  );

  const previewCount = useMemo(
    () =>
      project?.saves.filter(
        (save) => save.ideaId === effectiveIdeaId && hasPreview(save)
      ).length ?? 0,
    [project, effectiveIdeaId]
  );
  const filterPreviews = showPreviewsOnly && previewCount > 0;
  const searching = query.trim().length > 0;

  // Filtering flattens collapsed groups so every matching save is visible.
  const visibleSections = useMemo(() => {
    if (!(filterPreviews || searching)) {
      return sections;
    }
    const keep = (save: Project["saves"][number]) =>
      (!filterPreviews || hasPreview(save)) &&
      (!searching || matchesSearch(save, query));
    return sections
      .map((section) => ({
        ...section,
        items: section.items
          .flatMap((item): DisplayItem[] =>
            item.type === "group"
              ? item.saves.map((save) => ({ save, type: "save" }))
              : [{ save: item.save, type: "save" }]
          )
          .filter((item) => item.type === "save" && keep(item.save)),
      }))
      .filter((section) => section.items.length > 0);
  }, [filterPreviews, searching, query, sections]);

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

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-[13px] text-muted-foreground">
        {projectCount === 0
          ? "Add a watched folder from the sidebar to find your Ableton projects."
          : "Select a project to see its checkpoints."}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ProjectBanners project={project} />

      {project.saves.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EmptyHistory project={project} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="scrollbar-thin min-w-0 flex-1 overflow-y-auto px-4 pb-24">
            <div className="sticky top-0 z-10 -mx-4 border-line border-b bg-background/95 px-4 backdrop-blur">
              <div className="flex min-h-11 items-center justify-between gap-3 pt-1 pl-2">
                {project.ideas.length > 1 ? (
                  <SetSelector
                    activeIdeaId={activeIdeaId}
                    onSelect={setActiveIdea}
                    project={project}
                  />
                ) : (
                  <span className="font-medium text-[13px]">Checkpoints</span>
                )}
                {previewCount > 0 && (
                  <Button
                    aria-pressed={showPreviewsOnly}
                    className={cn(!showPreviewsOnly && "text-muted-foreground")}
                    onClick={() => setShowPreviewsOnly((v) => !v)}
                    size="xs"
                    type="button"
                    variant={showPreviewsOnly ? "secondary" : "ghost"}
                  >
                    <MusicNotes size={13} />
                    With audio only ({previewCount})
                  </Button>
                )}
              </div>
              <div className="pb-2.5">
                <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-raised px-2.5 text-[13px] focus-within:border-input">
                  <MagnifyingGlass
                    className="shrink-0 text-subtle-foreground"
                    size={13}
                  />
                  <input
                    className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle-foreground"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setQuery("");
                      }
                    }}
                    placeholder="Find a change — try “bass”, “tempo”, “louder”"
                    value={query}
                  />
                  {searching && (
                    <span className="shrink-0 text-[11px] text-subtle-foreground">
                      {visibleSections.reduce(
                        (sum, s) => sum + s.items.length,
                        0
                      )}{" "}
                      found
                    </span>
                  )}
                </label>
              </div>
            </div>

            {visibleSections.length === 0 ? (
              <p className="py-12 text-center text-[13px] text-muted-foreground">
                {searching
                  ? `No saves in this set mention “${query.trim()}”.`
                  : "No checkpoints for this set yet."}
              </p>
            ) : (
              <div>
                {visibleSections.map((section) => (
                  <TimelineSectionView
                    key={section.key}
                    onToggleGroup={toggleGroup}
                    onToggleSave={toggleSave}
                    project={project}
                    query={query}
                    section={section}
                    selectedSaveId={selectedSaveId}
                  />
                ))}
              </div>
            )}
          </div>

          {selectedSave && (
            <aside className="scrollbar-thin w-[min(60%,780px)] min-w-[480px] shrink-0 overflow-y-auto border-line border-s bg-sidebar">
              <CheckpointDetail
                idea={selectedIdea}
                isHead={selectedIdea?.headSaveId === selectedSave.id}
                key={selectedSave.id}
                onClose={() => toggleSave(selectedSave.id)}
                project={project}
                save={selectedSave}
              />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
