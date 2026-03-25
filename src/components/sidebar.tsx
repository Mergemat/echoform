import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { ActivityItem, Project } from '@/lib/types';
import {
  FolderSimplePlus,
  Eye,
  EyeSlash,
  MagnifyingGlass,
  WarningCircle,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { RootManagerDialog } from '@/components/root-manager-dialog';
import { ProjectSearchCommand } from '@/components/project-search-command';

function formatRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function projectHealth(project: Project): {
  label: string;
  dotClass: string;
  textClass: string;
} {
  if (project.presence === 'missing') {
    return {
      label: 'Missing',
      dotClass: 'bg-amber-400',
      textClass: 'text-amber-300/70',
    };
  }
  if (project.watchError) {
    return {
      label: 'Error',
      dotClass: 'bg-red-400',
      textClass: 'text-red-300/70',
    };
  }
  if (!project.watching) {
    return {
      label: 'Paused',
      dotClass: 'bg-white/25',
      textClass: 'text-white/35',
    };
  }
  return {
    label: 'Watching',
    dotClass: 'bg-emerald-400 animate-pulse',
    textClass: 'text-emerald-300/70',
  };
}

function ActivityFeedItem({ item }: { item: ActivityItem }) {
  const toneClass =
    item.severity === 'error'
      ? 'text-red-200/75'
      : item.severity === 'warning'
        ? 'text-amber-200/75'
        : item.severity === 'success'
          ? 'text-emerald-200/75'
          : 'text-white/55';

  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <div className={cn('text-[10px] leading-4 truncate', toneClass)}>
        {item.message}
      </div>
      <div className="text-[9px] text-white/20 shrink-0">
        {formatRelative(item.createdAt)}
      </div>
    </div>
  );
}

export function ProjectItem({
  project,
  selected,
}: {
  project: Project;
  selected: boolean;
}) {
  const selectProject = useStore((state) => state.selectProject);
  const send = useStore((state) => state.send);
  const health = projectHealth(project);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectProject(project.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => selectProject(project.id)}
      onKeyDown={handleKeyDown}
      className={cn(
        'group w-full cursor-pointer select-none rounded-md px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/15',
        selected
          ? 'bg-white/[0.08] text-white'
          : 'text-white/50 hover:bg-white/[0.04] hover:text-white/70',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="truncate text-[13px] font-medium">
            {project.name}
          </span>
          <div className="mt-1 flex items-center gap-1.5 text-[10px]">
            <div className={cn('size-1.5 rounded-full', health.dotClass)} />
            <span className={health.textClass}>{health.label}</span>
          </div>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={(event) => {
                event.stopPropagation();
                send({
                  type: 'toggle-watching',
                  projectId: project.id,
                  watching: !project.watching,
                });
              }}
              className={cn(
                'shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
                project.watching ? 'text-emerald-400' : 'text-white/30',
              )}
              disabled={project.presence === 'missing'}
            >
              {project.watching ? <Eye size={14} /> : <EyeSlash size={14} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {project.presence === 'missing'
              ? 'Missing on disk'
              : project.watching
                ? 'Pause protection'
                : 'Resume protection'}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="mt-1.5 text-[11px] text-white/30">
        {project.saves.length > 0 ? (
          <span>
            {project.saves.length} save{project.saves.length === 1 ? '' : 's'}
          </span>
        ) : (
          <span>No saves yet</span>
        )}
      </div>

      {project.watchError && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-200/70">
          <WarningCircle size={12} />
          <span className="truncate">{project.watchError}</span>
        </div>
      )}
    </div>
  );
}

export function AppSidebar() {
  const projects = useStore((state) => state.projects);
  const activity = useStore((state) => state.activity);
  const selectedProjectId = useStore((state) => state.selectedProjectId);
  const connected = useStore((state) => state.connected);
  const [managerOpen, setManagerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const sorted = useMemo(
    () =>
      [...projects].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [projects],
  );

  return (
    <TooltipProvider>
      <div className="flex h-full w-full flex-col overflow-hidden border-r border-white/[0.06] bg-white/[0.02]">
        <div className="shrink-0 border-b border-white/[0.06] px-3 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight text-white/90">
                Ablegit
              </h1>
              <p className="mt-1 text-[11px] text-white/25">
                watch my folders, keep my work safe
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setManagerOpen(true)}
                  className="text-white/30 hover:text-white/60"
                >
                  <FolderSimplePlus size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Watch my folders</TooltipContent>
            </Tooltip>
          </div>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="mt-3 flex w-full items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-white/25 hover:bg-white/[0.05] hover:text-white/40 transition-colors"
          >
            <MagnifyingGlass size={12} />
            <span className="flex-1 text-left">Search projects...</span>
            <kbd className="text-[9px] text-white/15 border border-white/[0.08] rounded px-1 py-px">
              {navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl+'}K
            </kbd>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5">
          {sorted.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              selected={project.id === selectedProjectId}
            />
          ))}

          {projects.length === 0 && (
            <div className="px-3 py-8 text-center text-[12px] text-white/20">
              No watched projects yet.
              <br />
              Point Ablegit at one or more music folders.
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-white/[0.06] px-3 py-2">
          <div className="mb-1">
            <div className="flex items-center gap-1.5 text-[10px] text-white/20">
              Recent activity
              <div
                className={cn(
                  'size-1.5 rounded-full',
                  connected ? 'bg-emerald-400/80' : 'bg-red-300/80',
                )}
              />
            </div>
          </div>

          <div>
            {activity.length === 0 ? (
              <div className="py-1 text-[10px] text-white/20">
                No activity yet
              </div>
            ) : (
              activity
                .slice(0, 3)
                .map((item) => <ActivityFeedItem key={item.id} item={item} />)
            )}
          </div>
        </div>
      </div>

      <RootManagerDialog open={managerOpen} onOpenChange={setManagerOpen} />
      <ProjectSearchCommand open={searchOpen} onOpenChange={setSearchOpen} />
    </TooltipProvider>
  );
}
