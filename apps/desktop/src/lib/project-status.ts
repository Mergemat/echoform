import type { Project } from "@/lib/types";

/** When the newest checkpoint was recorded; `updatedAt` also moves on settings changes. */
export function lastCheckpointAt(project: Project): string | null {
  let latest: string | null = null;
  for (const save of project.saves) {
    if (!latest || save.createdAt > latest) {
      latest = save.createdAt;
    }
  }
  return latest;
}

export type ProjectStatusTone = "ok" | "paused" | "warning" | "error";

export interface ProjectStatus {
  /** One-line explanation of what Echoform is (or isn't) doing right now. */
  description: string;
  label: string;
  tone: ProjectStatusTone;
}

/**
 * The single source of truth for "is this project protected right now?".
 * Every surface (sidebar, header, search) must use this so they never disagree.
 */
export function getProjectStatus(project: Project): ProjectStatus {
  if (project.presence === "missing") {
    return {
      description:
        "The project folder moved or is unavailable. History is safe, but new saves are not being recorded.",
      label: "Folder missing",
      tone: "warning",
    };
  }
  if (project.watchError) {
    return {
      description: project.watchError,
      label: "Not recording",
      tone: "error",
    };
  }
  if (!project.watching) {
    return {
      description: "Saves in Ableton are not being recorded until you resume.",
      label: "Paused",
      tone: "paused",
    };
  }
  return {
    description: "Every save in Ableton becomes a checkpoint.",
    label: "Recording saves",
    tone: "ok",
  };
}

export const STATUS_DOT_CLASS: Record<ProjectStatusTone, string> = {
  error: "bg-destructive",
  ok: "bg-success",
  paused: "bg-subtle-foreground",
  warning: "bg-warning",
};

export const STATUS_TEXT_CLASS: Record<ProjectStatusTone, string> = {
  error: "text-destructive",
  ok: "text-success",
  paused: "text-muted-foreground",
  warning: "text-warning",
};
