import {
  Eye,
  EyeSlash,
  FolderSimplePlus,
  MagnifyingGlass,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Logo } from "@/components/logo";
import { ProjectSearchCommand } from "@/components/project-search-command";
import { RootManagerDialog } from "@/components/root-manager-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { usePreviewStore } from "@/lib/preview-store";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

function projectHealth(project: Project): {
  label: string;
  dotClass: string;
  textClass: string;
} {
  if (project.presence === "missing") {
    return {
      label: "Missing",
      dotClass: "bg-amber-400",
      textClass: "text-amber-400/80",
    };
  }
  if (project.watchError) {
    return {
      label: "Error",
      dotClass: "bg-red-400",
      textClass: "text-red-400/80",
    };
  }
  if (!project.watching) {
    return {
      label: "Paused",
      dotClass: "bg-white/20",
      textClass: "text-white/30",
    };
  }
  return {
    label: "Watching",
    dotClass: "bg-emerald-400 animate-pulse",
    textClass: "text-emerald-400/70",
  };
}

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
  const health = projectHealth(project);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    closePreviewPlayer();
    selectProject(project.id);
  };

  return (
    <div
      className={cn(
        "group w-full cursor-pointer select-none rounded-lg px-3 py-2.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20",
        selected
          ? "bg-white/[0.08] text-white shadow-sm shadow-white/[0.02]"
          : "text-white/50 hover:bg-white/[0.04] hover:text-white/70"
      )}
      onClick={() => {
        closePreviewPlayer();
        selectProject(project.id);
      }}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm leading-tight">
            {project.name}
          </span>
          <div className="mt-1.5 flex items-center gap-1.5">
            <div
              className={cn("size-2 shrink-0 rounded-full", health.dotClass)}
            />
            <span className={cn("text-[11px] leading-none", health.textClass)}>
              {health.label}
            </span>
            <span className="ml-auto text-[11px] text-white/20 tabular-nums">
              {project.saves.length > 0
                ? `${project.saves.length} save${project.saves.length === 1 ? "" : "s"}`
                : "No saves"}
            </span>
          </div>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className={cn(
                "shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
                project.watching ? "text-emerald-400" : "text-white/30"
              )}
              disabled={project.presence === "missing"}
              onClick={(event) => {
                event.stopPropagation();
                sendDaemonCommand({
                  type: "toggle-watching",
                  projectId: project.id,
                  watching: !project.watching,
                });
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              {project.watching ? <Eye size={14} /> : <EyeSlash size={14} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {project.presence === "missing"
              ? "Missing on disk"
              : project.watching
                ? "Pause protection"
                : "Resume protection"}
          </TooltipContent>
        </Tooltip>
      </div>

      {project.watchError && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-300/70">
          <WarningCircle className="shrink-0" size={12} />
          <span className="truncate">{project.watchError}</span>
        </div>
      )}
    </div>
  );
});

function FolderManagerButton() {
  const [managerOpen, setManagerOpen] = useState(false);
  const openedFromPointerRef = useRef(false);

  const openManager = () => setManagerOpen(true);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    openedFromPointerRef.current = true;
    openManager();
  };

  const handleClick = () => {
    if (openedFromPointerRef.current) {
      openedFromPointerRef.current = false;
      return;
    }
    openManager();
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="text-white/25 hover:text-white/60"
            onClick={handleClick}
            onPointerDown={handlePointerDown}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <FolderSimplePlus size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Watch my folders</TooltipContent>
      </Tooltip>

      <RootManagerDialog onOpenChange={setManagerOpen} open={managerOpen} />
    </>
  );
}

const VirtualizedProjectList = memo(function VirtualizedProjectList({
  projects,
  selectedProjectId,
  isEmpty,
}: {
  projects: Project[];
  selectedProjectId: string | null;
  isEmpty: boolean;
}) {
  if (isEmpty) {
    return (
      <div className="min-h-0 flex-1 px-2 py-1">
        <div className="px-3 py-8 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-white/[0.04]">
            <FolderSimplePlus className="text-white/15" size={18} />
          </div>
          <div className="mt-3 font-medium text-[13px] text-white/30">
            No projects found
          </div>
          <div className="mt-1 text-[11px] text-white/15 leading-relaxed">
            Add a music folder above to start
            <br />
            protecting your sessions.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-1">
      <div className="space-y-0.5">
        {projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            selected={project.id === selectedProjectId}
          />
        ))}
      </div>
    </div>
  );
});

export function AppSidebar() {
  const projects = useStore((state) => state.projects);
  const selectedProjectId = useStore((state) => state.selectedProjectId);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenedFromPointerRef = useRef(false);
  const openSearch = () => setSearchOpen(true);

  const handleSearchPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    searchOpenedFromPointerRef.current = true;
    openSearch();
  };

  const handleSearchClick = () => {
    if (searchOpenedFromPointerRef.current) {
      searchOpenedFromPointerRef.current = false;
      return;
    }
    openSearch();
  };

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
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
      [...projects].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [projects]
  );

  return (
    <TooltipProvider>
      <div className="flex h-full w-full flex-col overflow-hidden border-border border-r bg-white/[0.015]">
        {/* Header – padded below macOS traffic lights */}
        <div className="shrink-0 px-4 pt-10 pb-3">
          <div
            className="flex items-center justify-between"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          >
            <div className="flex items-center gap-2">
              <Logo className="size-4 text-white/90" />
              <h1 className="font-semibold text-base text-white/90 tracking-tight">
                Echoform
              </h1>
            </div>
            <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
              <FolderManagerButton />
            </div>
          </div>

          <button
            className="mt-3 flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-[13px] text-white/25 transition-all duration-150 hover:border-white/[0.1] hover:bg-white/[0.05] hover:text-white/40"
            onClick={handleSearchClick}
            onPointerDown={handleSearchPointerDown}
            type="button"
          >
            <MagnifyingGlass className="shrink-0 text-white/20" size={13} />
            <span className="flex-1 text-left">Search projects...</span>
            <kbd className="rounded border border-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-white/15">
              {navigator.platform?.includes("Mac") ? "\u2318K" : "Ctrl+K"}
            </kbd>
          </button>
        </div>

        {/* Project list */}
        <VirtualizedProjectList
          isEmpty={projects.length === 0}
          projects={sorted}
          selectedProjectId={selectedProjectId}
        />
      </div>

      <ProjectSearchCommand onOpenChange={setSearchOpen} open={searchOpen} />
    </TooltipProvider>
  );
}
