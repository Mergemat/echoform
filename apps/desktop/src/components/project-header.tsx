import { Play } from "@phosphor-icons/react";
import { DiskUsagePanel } from "@/components/disk-usage-panel";
import { fileTabName } from "@/components/timeline-utils";
import { Button } from "@/components/ui/button";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { posthog } from "@/lib/posthog";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

function projectHealth(project: Project) {
  if (project.presence === "missing") {
    return {
      dotClass: "bg-amber-400",
      label: "Missing on disk",
    };
  }
  if (project.watchError) {
    return {
      dotClass: "bg-red-400",
      label: "Watcher error",
    };
  }
  if (!project.watching) {
    return {
      dotClass: "bg-white/20",
      label: "Paused",
    };
  }
  return {
    dotClass: "animate-pulse bg-emerald-400",
    label: "Watching",
  };
}

export function ProjectHeader() {
  const project = useStore((state) => state.selectedProject());
  const activeIdeaId = useStore((state) => state.activeIdeaId);

  if (!project) {
    return null;
  }

  const focusedIdea = project.ideas.find(
    (idea) => idea.id === (activeIdeaId ?? project.currentIdeaId)
  );
  const pendingIdea = project.pendingOpen
    ? project.ideas.find((idea) => idea.id === project.pendingOpen?.ideaId)
    : null;
  const health = projectHealth(project);
  const canOpenFiles = project.presence === "active";
  const activeSaveCount = focusedIdea
    ? project.saves.filter((save) => save.ideaId === focusedIdea.id).length
    : project.saves.length;

  return (
    <header className="shrink-0 px-8 pt-8 pb-3">
      <div className="mx-auto flex w-full max-w-[980px] items-start justify-between gap-8">
        <div className="min-w-0">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-[11px]",
              health.dotClass === "animate-pulse bg-emerald-400"
                ? "bg-emerald-400/10 text-emerald-300"
                : "bg-amber-400/10 text-amber-200"
            )}
          >
            <span
              className={cn("size-1.5 shrink-0 rounded-full", health.dotClass)}
            />
            {health.label === "Watching" ? "Protecting changes" : health.label}
          </span>
          <h2 className="mt-4 truncate font-semibold text-[28px] text-white tracking-[-0.035em]">
            {project.name}
          </h2>
          <p className="mt-1 text-[13px] text-white/35">
            {activeSaveCount} checkpoints
            {focusedIdea ? ` in ${fileTabName(focusedIdea)}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 pt-1">
          <Button
            className="rounded-xl bg-white text-[13px] text-zinc-950 hover:bg-zinc-200"
            disabled={!canOpenFiles}
            onClick={() => {
              const targetIdeaId = pendingIdea?.id ?? focusedIdea?.id;
              if (!targetIdeaId) {
                return;
              }
              posthog.capture("idea_opened_in_ableton", {
                source: "project_header",
              });
              sendDaemonCommand({
                ideaId: targetIdeaId,
                projectId: project.id,
                type: "open-idea",
              });
            }}
            type="button"
          >
            <Play size={13} weight="fill" />
            Open current set
          </Button>
          <Button
            className="text-white/35 hover:text-white/60"
            disabled={!canOpenFiles}
            onClick={() => {
              const targetIdeaId = pendingIdea?.id ?? focusedIdea?.id;
              if (!targetIdeaId) {
                return;
              }
              posthog.capture("idea_revealed_in_finder", {
                source: "project_header",
              });
              sendDaemonCommand({
                ideaId: targetIdeaId,
                projectId: project.id,
                type: "reveal-idea-file",
              });
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Reveal
          </Button>

          <div className="mx-1 h-5 w-px bg-white/[0.06]" />

          <DiskUsagePanel projectId={project.id} />
        </div>
      </div>
    </header>
  );
}
