import {
  ArrowCircleUp,
  FolderSimple,
  GitBranch,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { memo, useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/logo";
import { ProjectSearchCommand } from "@/components/project-search-command";
import { RootManagerDialog } from "@/components/root-manager-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppUpdate } from "@/hooks/use-app-update";
import { useConnectionStore } from "@/lib/connection-store";
import { posthog } from "@/lib/posthog";
import { usePreviewStore } from "@/lib/preview-store";
import {
  getProjectStatus,
  lastCheckpointAt,
  STATUS_DOT_CLASS,
  STATUS_TEXT_CLASS,
} from "@/lib/project-status";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

const IS_MAC =
  typeof navigator !== "undefined" && navigator.platform?.includes("Mac");

export const ProjectItem = memo(function ProjectItem({
  project,
  selected,
}: {
  project: Project;
  selected: boolean;
}) {
  const selectProject = useStore((state) => state.selectProject);
  const closePreviewPlayer = usePreviewStore(
    (state) => state.closePreviewPlayer
  );
  const status = getProjectStatus(project);
  const lastAt = lastCheckpointAt(project);

  return (
    <button
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        selected
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
      onClick={() => {
        posthog.capture("project_selected", { source: "sidebar" });
        closePreviewPlayer();
        selectProject(project.id);
      }}
      type="button"
    >
      <span
        aria-hidden
        className={cn(
          "mt-[5px] size-2 shrink-0 rounded-full",
          STATUS_DOT_CLASS[status.tone]
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {project.continuedFrom && (
            <GitBranch
              aria-label="Branch"
              className="shrink-0 text-subtle-foreground"
              size={12}
            />
          )}
          <span className="truncate font-medium text-[13px] leading-snug">
            {project.name}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-subtle-foreground">
          {status.tone === "ok" ? (
            lastAt ? (
              `Last checkpoint ${timeAgo(lastAt).toLowerCase()}`
            ) : (
              "Waiting for first save"
            )
          ) : (
            <span className={STATUS_TEXT_CLASS[status.tone]}>
              {status.label}
            </span>
          )}
        </span>
      </span>
    </button>
  );
});

function UpdateButton() {
  const { updateAvailable, version, openUpdate } = useAppUpdate();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!updateAvailable) {
    return null;
  }

  return (
    <>
      <Button
        className="w-full justify-start text-success"
        onClick={() => setDialogOpen(true)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <ArrowCircleUp size={15} />
        Update available
      </Button>

      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update available</DialogTitle>
            <DialogDescription>
              Echoform v{version} is ready to download. Your projects and
              history are not affected by updating.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                posthog.capture("update_download_started");
                openUpdate();
                setDialogOpen(false);
              }}
              type="button"
            >
              Download update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConnectionStatus() {
  const connected = useConnectionStore((s) => s.connected);
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-[11px]",
        connected ? "text-subtle-foreground" : "text-warning"
      )}
      title={
        connected
          ? "Echoform's background service is running"
          : "Reconnecting to Echoform's background service"
      }
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          connected ? "bg-success" : "animate-pulse bg-warning"
        )}
      />
      {connected ? "Running" : "Reconnecting"}
    </span>
  );
}

export function AppSidebar() {
  const projects = useStore((state) => state.projects);
  const roots = useStore((state) => state.roots);
  const selectedProjectId = useStore((state) => state.selectedProjectId);
  const [searchOpen, setSearchOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) =>
        (lastCheckpointAt(b) ?? b.updatedAt).localeCompare(
          lastCheckpointAt(a) ?? a.updatedAt
        )
      ),
    [projects]
  );

  return (
    <aside className="flex h-full w-full flex-col border-border border-e bg-sidebar">
      {/* Padded below the macOS traffic lights; the strip is draggable. */}
      <div
        className="flex shrink-0 items-center justify-between px-4 pt-11 pb-3"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <Logo className="size-4 text-foreground" />
          <span className="font-semibold text-[14px] tracking-tight">
            Echoform
          </span>
        </div>
        <ConnectionStatus />
      </div>

      <div className="shrink-0 px-3 pb-3">
        <button
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 text-[12px] text-subtle-foreground transition-colors duration-100 hover:border-input hover:text-muted-foreground"
          onClick={() => setSearchOpen(true)}
          type="button"
        >
          <MagnifyingGlass className="shrink-0" size={13} />
          <span className="flex-1 text-left">Find a project</span>
          <kbd className="font-mono text-[10px]">
            {IS_MAC ? "⌘K" : "Ctrl+K"}
          </kbd>
        </button>
      </div>

      <div className="flex items-baseline justify-between px-5 pb-1.5">
        <span className="font-medium text-[11px] text-subtle-foreground">
          Projects
        </span>
        <span className="text-[11px] text-subtle-foreground tabular-nums">
          {projects.length}
        </span>
      </div>

      <nav className="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {sorted.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-muted-foreground leading-relaxed">
            No projects yet. Add the folder where you keep your Ableton
            projects.
          </p>
        ) : (
          sorted.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              selected={project.id === selectedProjectId}
            />
          ))
        )}
      </nav>

      <div className="shrink-0 space-y-1 border-border border-t p-2">
        <UpdateButton />
        <Button
          className="w-full justify-start text-muted-foreground"
          onClick={() => setFoldersOpen(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <FolderSimple size={15} />
          Watched folders
          <span className="ml-auto text-[11px] text-subtle-foreground tabular-nums">
            {roots.length}
          </span>
        </Button>
      </div>

      <RootManagerDialog onOpenChange={setFoldersOpen} open={foldersOpen} />
      <ProjectSearchCommand onOpenChange={setSearchOpen} open={searchOpen} />
    </aside>
  );
}
