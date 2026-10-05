import { FolderOpen, GitBranch, Play } from "@phosphor-icons/react";
import { DiskUsagePanel } from "@/components/disk-usage-panel";
import { RelinkProjectButton } from "@/components/relink-project-button";
import { fileTabName, getSaveDisplayTitle } from "@/components/timeline-utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { posthog } from "@/lib/posthog";
import {
  getProjectStatus,
  STATUS_DOT_CLASS,
  STATUS_TEXT_CLASS,
} from "@/lib/project-status";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { cn, shortenPath } from "@/lib/utils";

const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

function BranchLineage({ project }: { project: Project }) {
  const projects = useStore((state) => state.projects);
  const selectProject = useStore((state) => state.selectProject);
  const lineage = project.continuedFrom;
  if (!lineage) {
    return null;
  }
  const source = projects.find((p) => p.id === lineage.projectId);
  const sourceSave = source?.saves.find((s) => s.id === lineage.saveId);

  return (
    <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <GitBranch className="shrink-0" size={13} />
      <span>Branched from</span>
      {source ? (
        <button
          className="font-medium text-foreground underline-offset-2 hover:underline"
          onClick={() => selectProject(source.id)}
          type="button"
        >
          {source.name}
        </button>
      ) : (
        <span>a project no longer in Echoform</span>
      )}
      {sourceSave && (
        <span className="text-subtle-foreground">
          · {getSaveDisplayTitle(sourceSave)}
        </span>
      )}
    </div>
  );
}

function WatchToggle({ project }: { project: Project }) {
  if (project.presence === "missing") {
    return <RelinkProjectButton projectId={project.id} />;
  }
  // A watcher error leaves `watching` on; re-sending "watch" restarts it.
  const retry = project.watching && Boolean(project.watchError);
  const nextWatching = retry || !project.watching;
  return (
    <Button
      className="h-7 px-2 text-[12px]"
      onClick={() => {
        posthog.capture("watching_toggled", { watching: nextWatching });
        sendDaemonCommand({
          projectId: project.id,
          type: "toggle-watching",
          watching: nextWatching,
        });
      }}
      size="xs"
      type="button"
      variant={nextWatching ? "secondary" : "ghost"}
    >
      {retry ? "Retry" : project.watching ? "Pause" : "Resume recording"}
    </Button>
  );
}

export function ProjectHeader() {
  const project = useStore((state) => state.selectedProject());
  const activeIdeaId = useStore((state) => state.activeIdeaId);

  if (!project) {
    return null;
  }

  const focusedIdea =
    project.ideas.find(
      (idea) => idea.id === (activeIdeaId ?? project.currentIdeaId)
    ) ?? project.ideas[0];
  const status = getProjectStatus(project);
  const canOpenFiles = project.presence === "active" && Boolean(focusedIdea);
  const setName = focusedIdea ? fileTabName(focusedIdea) : null;

  return (
    // The window has no title bar, so the header doubles as the drag handle.
    <header
      className="shrink-0 border-border border-b px-8 pt-10 pb-5"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0" style={NO_DRAG}>
          <h1 className="truncate font-semibold text-[22px] tracking-tight">
            {project.name}
          </h1>
          <BranchLineage project={project} />
          <div
            className="mt-1 truncate font-mono text-[11px] text-subtle-foreground"
            title={project.projectPath}
          >
            {shortenPath(project.projectPath)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5" style={NO_DRAG}>
          <Button
            disabled={!canOpenFiles}
            onClick={() => {
              if (!focusedIdea) {
                return;
              }
              posthog.capture("idea_opened_in_ableton", {
                source: "project_header",
              });
              sendDaemonCommand({
                ideaId: focusedIdea.id,
                projectId: project.id,
                type: "open-idea",
              });
            }}
            title={setName ? `Open ${setName}.als in Ableton` : undefined}
            type="button"
          >
            <Play size={13} weight="fill" />
            Open in Ableton
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Show in Finder"
                disabled={!canOpenFiles}
                onClick={() => {
                  if (!focusedIdea) {
                    return;
                  }
                  posthog.capture("idea_revealed_in_finder", {
                    source: "project_header",
                  });
                  sendDaemonCommand({
                    ideaId: focusedIdea.id,
                    projectId: project.id,
                    type: "reveal-idea-file",
                  });
                }}
                size="icon"
                type="button"
                variant="outline"
              >
                <FolderOpen size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Show in Finder</TooltipContent>
          </Tooltip>
          <DiskUsagePanel projectId={project.id} />
        </div>
      </div>

      <div
        className="mt-4 flex w-fit flex-wrap items-center gap-x-3 gap-y-2"
        style={NO_DRAG}
      >
        <span className="flex items-center gap-2 text-[12px]">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              STATUS_DOT_CLASS[status.tone]
            )}
          />
          <span className={cn("font-medium", STATUS_TEXT_CLASS[status.tone])}>
            {status.label}
          </span>
          <span className="text-muted-foreground">{status.description}</span>
        </span>
        <WatchToggle project={project} />
      </div>
    </header>
  );
}
