import {
  CheckCircle,
  Circle,
  CircleNotch,
  Clock,
  Pause,
  Plus,
  Warning,
} from "@phosphor-icons/react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { posthog } from "@/lib/posthog";
import { usePreviewStore } from "@/lib/preview-store";
import { useStore } from "@/lib/store";
import type { DiscoveredProject, Project } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Constants ────────────────────────────────────────────────────────

const MAX_RECENT_TRACKED = 40;
const MAX_SEARCH_RESULTS = 100;
const DISCOVER_DELAY_MS = 0;

// ── Helpers ──────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) {
    return "just now";
  }
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  const d = Math.floor(h / 24);
  if (d < 7) {
    return `${d}d ago`;
  }
  return new Date(iso).toLocaleDateString();
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Matches both name and path segments for better disambiguation.
 * "my track" matches "My Track v2" and "/music/my-track/..."
 */
function matchesSearch(name: string, search: string, path?: string): boolean {
  if (search.length === 0) {
    return true;
  }
  const haystack = path ? `${name}\0${path}`.toLowerCase() : name.toLowerCase();
  return haystack.includes(search);
}

/**
 * Detects duplicate project names so we can show disambiguating paths.
 */
function buildNameCounts(projects: Project[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of projects) {
    const lower = p.name.toLowerCase();
    counts.set(lower, (counts.get(lower) ?? 0) + 1);
  }
  return counts;
}

/** Returns the last N path segments as a disambiguator, e.g. "~/Music/Projects" */
function shortenPath(fullPath: string, segments = 2): string {
  const parts = fullPath.replace(/\/+$/, "").split("/");
  const tail = parts.slice(-segments).join("/");
  return parts.length > segments ? `~/${tail}` : tail;
}

interface HealthInfo {
  className: string;
  icon: React.ReactNode;
  label: string;
}

function projectHealth(project: Project): HealthInfo {
  if (project.presence === "missing") {
    return {
      label: "Missing",
      icon: <Warning className="size-3" weight="fill" />,
      className: "text-amber-400",
    };
  }
  if (project.watchError) {
    return {
      label: "Error",
      icon: <Warning className="size-3" weight="fill" />,
      className: "text-red-400",
    };
  }
  if (!project.watching) {
    return {
      label: "Paused",
      icon: <Pause className="size-3" weight="fill" />,
      className: "text-white/30",
    };
  }
  return {
    label: "Watching",
    icon: <Circle className="size-2" weight="fill" />,
    className: "text-emerald-400",
  };
}

function savesLabel(count: number): string {
  if (count === 0) {
    return "No saves";
  }
  return `${count} save${count === 1 ? "" : "s"}`;
}

// ── Subcomponents ────────────────────────────────────────────────────

function TrackedProjectRow({
  project,
  isActive,
  showPath,
}: {
  project: Project;
  isActive: boolean;
  showPath: boolean;
}) {
  const health = projectHealth(project);

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("shrink-0", health.className)}>{health.icon}</span>
        <div className="min-w-0 flex-1">
          <span className="block truncate">{project.name}</span>
          {showPath && (
            <span className="block truncate text-[10px] text-muted-foreground/60">
              {shortenPath(project.projectPath, 3)}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {isActive && (
          <CheckCircle className="size-3.5 text-white/50" weight="fill" />
        )}
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
          {savesLabel(project.saves.length)}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="size-3" />
          {formatRelative(project.updatedAt)}
        </span>
      </div>
    </>
  );
}

function DiscoveredProjectRow({ project }: { project: DiscoveredProject }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <Plus className="size-3.5 shrink-0 text-emerald-400" />
        <span className="truncate">{project.name}</span>
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
        {project.setFiles.length} .als
      </span>
    </>
  );
}

function DiscoveringIndicator() {
  return (
    <div className="flex items-center justify-center gap-2 py-3 text-muted-foreground text-xs">
      <CircleNotch className="size-3.5 animate-spin" />
      <span>Discovering projects...</span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export function ProjectSearchCommand({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const projects = useStore((s) => s.projects);
  const discoveredProjects = useStore((s) => s.discoveredProjects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const selectProject = useStore((s) => s.selectProject);
  const closePreviewPlayer = usePreviewStore((s) => s.closePreviewPlayer);

  const [search, setSearch] = useState("");
  const [discoveryStartedAt, setDiscoveryStartedAt] = useState<number | null>(
    null
  );
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = normalizeSearch(deferredSearch);
  const hasTriggeredDiscoverRef = useRef(false);

  useEffect(() => {
    if (!open) {
      hasTriggeredDiscoverRef.current = false;
      return;
    }

    if (!hasTriggeredDiscoverRef.current) {
      const timer = window.setTimeout(() => {
        setDiscoveryStartedAt(Date.now());
        sendDaemonCommand({ type: "discover-projects" });
      }, DISCOVER_DELAY_MS);
      hasTriggeredDiscoverRef.current = true;
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  const discovering =
    open && discoveryStartedAt !== null && discoveredProjects.length === 0;

  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [projects]
  );

  const nameCounts = useMemo(
    () => buildNameCounts(sortedProjects),
    [sortedProjects]
  );

  const trackedResults = useMemo(() => {
    const filtered = sortedProjects.filter((project) =>
      matchesSearch(project.name, normalizedSearch, project.projectPath)
    );
    return normalizedSearch.length === 0
      ? filtered.slice(0, MAX_RECENT_TRACKED)
      : filtered.slice(0, MAX_SEARCH_RESULTS);
  }, [normalizedSearch, sortedProjects]);

  const untrackedResults = useMemo(() => {
    if (normalizedSearch.length === 0) {
      return [];
    }

    return discoveredProjects
      .filter((project) => !project.tracked)
      .filter((project) =>
        matchesSearch(project.name, normalizedSearch, project.path)
      )
      .slice(0, MAX_SEARCH_RESULTS);
  }, [discoveredProjects, normalizedSearch]);

  function handleSelect(id: string) {
    posthog.capture("project_selected", { source: "search" });
    closePreviewPlayer();
    selectProject(id);
    setSearch("");
    setDiscoveryStartedAt(null);
    onOpenChange(false);
  }

  function handleTrack(path: string, name: string) {
    posthog.capture("project_tracked", { source: "search" });
    sendDaemonCommand({ type: "track-project", projectPath: path, name });
    setSearch("");
    setDiscoveryStartedAt(null);
    onOpenChange(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSearch("");
      setDiscoveryStartedAt(null);
      hasTriggeredDiscoverRef.current = false;
    }
    onOpenChange(nextOpen);
  }

  const isSearching = normalizedSearch.length > 0;
  const hasNoResults =
    trackedResults.length === 0 && untrackedResults.length === 0;

  return (
    <CommandDialog
      className="sm:max-w-2xl"
      description="Search and switch between projects"
      onOpenChange={handleOpenChange}
      open={open}
      title="Project search"
    >
      <Command disablePointerSelection shouldFilter={false}>
        <CommandInput
          onValueChange={setSearch}
          placeholder="Search projects..."
          value={search}
        />
        <CommandList>
          {hasNoResults && !discovering && (
            <CommandEmpty>
              {isSearching
                ? "No matching projects found."
                : "No projects yet. Watch a folder to get started."}
            </CommandEmpty>
          )}

          {discovering && !isSearching && hasNoResults && (
            <DiscoveringIndicator />
          )}

          {trackedResults.length > 0 && (
            <CommandGroup
              heading={isSearching ? "Projects" : "Recent projects"}
            >
              {trackedResults.map((project) => {
                const isDuplicate =
                  (nameCounts.get(project.name.toLowerCase()) ?? 0) > 1;
                return (
                  <CommandItem
                    className="flex items-center justify-between gap-3"
                    key={project.id}
                    keywords={[project.name, project.projectPath]}
                    onSelect={() => handleSelect(project.id)}
                    value={project.id}
                  >
                    <TrackedProjectRow
                      isActive={project.id === selectedProjectId}
                      project={project}
                      showPath={isDuplicate || isSearching}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {untrackedResults.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Discovered — not tracked">
                {untrackedResults.map((project) => (
                  <CommandItem
                    className="flex items-center justify-between gap-3"
                    key={project.path}
                    keywords={[project.name, project.path]}
                    onSelect={() => handleTrack(project.path, project.name)}
                    value={project.path}
                  >
                    <DiscoveredProjectRow project={project} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {discovering && isSearching && <DiscoveringIndicator />}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
