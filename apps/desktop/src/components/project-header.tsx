import { Waveform } from "@phosphor-icons/react";
import { DiskUsagePanel } from "@/components/disk-usage-panel";
import { Button } from "@/components/ui/button";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { posthog } from "@/lib/posthog";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

function projectHealth(project: Project) {
  if (project.presence === "missing") {
    return {
      label: "Missing on disk",
      dotClass: "bg-amber-400",
      textClass: "text-amber-400/70",
    };
  }
  if (project.watchError) {
    return {
      label: "Watcher error",
      dotClass: "bg-red-400",
      textClass: "text-red-400/70",
    };
  }
  if (!project.watching) {
    return {
      label: "Paused",
      dotClass: "bg-white/20",
      textClass: "text-white/25",
    };
  }
  return {
    label: "Watching",
    dotClass: "bg-emerald-400 animate-pulse",
    textClass: "text-emerald-400/70",
  };
}

export function ProjectHeader() {
  const project = useStore((state) => state.selectedProject());

  if (!project) {
    return null;
  }

  const currentIdea = project.ideas.find(
    (idea) => idea.id === project.currentIdeaId
  );
  const pendingIdea = project.pendingOpen
    ? project.ideas.find((idea) => idea.id === project.pendingOpen?.ideaId)
    : null;
  const health = projectHealth(project);
  const canOpenFiles = project.presence === "active";

  return (
    <div className="flex items-center justify-between border-border border-b px-6 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
          <Waveform className="text-white/40" size={20} weight="bold" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-base text-white/90 leading-tight">
            {project.name}
          </h2>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span
              className={cn("size-2 shrink-0 rounded-full", health.dotClass)}
            />
            <span className={health.textClass}>{health.label}</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          className="text-white/50"
          disabled={!canOpenFiles}
          onClick={() => {
            const targetIdeaId = pendingIdea?.id ?? currentIdea?.id;
            if (!targetIdeaId) {
              return;
            }
            posthog.capture("idea_opened_in_ableton", {
              source: "project_header",
            });
            sendDaemonCommand({
              type: "open-idea",
              projectId: project.id,
              ideaId: targetIdeaId,
            });
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Open in Ableton
        </Button>
        <Button
          className="text-white/35 hover:text-white/60"
          disabled={!canOpenFiles}
          onClick={() => {
            const targetIdeaId = pendingIdea?.id ?? currentIdea?.id;
            if (!targetIdeaId) {
              return;
            }
            posthog.capture("idea_revealed_in_finder", {
              source: "project_header",
            });
            sendDaemonCommand({
              type: "reveal-idea-file",
              projectId: project.id,
              ideaId: targetIdeaId,
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
  );
}
