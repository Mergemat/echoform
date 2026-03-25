import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { sendDaemonCommand } from '@/lib/daemon-client';
import { usePreviewStore } from '@/lib/preview-store';
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command';
import { Plus, Clock } from '@phosphor-icons/react';

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProjectSearchCommand({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const projects = useStore((s) => s.projects);
  const discoveredProjects = useStore((s) => s.discoveredProjects);
  const selectProject = useStore((s) => s.selectProject);
  const closePreviewPlayer = usePreviewStore((s) => s.closePreviewPlayer);
  const [hasTriggeredDiscover, setHasTriggeredDiscover] = useState(false);

  // Trigger discover scan when dialog opens (once per open)
  useEffect(() => {
    if (open && !hasTriggeredDiscover) {
      sendDaemonCommand({ type: 'discover-projects' });
      setHasTriggeredDiscover(true);
    }
    if (!open) {
      setHasTriggeredDiscover(false);
    }
  }, [open, hasTriggeredDiscover]);

  // Sort tracked projects by updatedAt descending (most recently modified first)
  const sorted = [...projects].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  const untracked = discoveredProjects.filter((dp) => !dp.tracked);

  function handleSelect(id: string) {
    closePreviewPlayer();
    selectProject(id);
    onOpenChange(false);
  }

  function handleTrack(path: string, name: string) {
    sendDaemonCommand({ type: 'track-project', projectPath: path, name });
    onOpenChange(false);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Project search"
      description="Search and switch between projects"
      className="sm:max-w-2xl"
    >
      <Command>
        <CommandInput placeholder="Search projects..." />
        <CommandList>
          <CommandEmpty>No projects found.</CommandEmpty>

          {sorted.length > 0 && (
            <CommandGroup heading="Projects">
              {sorted.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => handleSelect(p.id)}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    {formatRelative(p.updatedAt)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {untracked.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Discovered — not tracked">
                {untracked.map((dp) => (
                  <CommandItem
                    key={dp.path}
                    value={dp.name}
                    onSelect={() => handleTrack(dp.path, dp.name)}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Plus className="size-3.5 shrink-0 text-emerald-400" />
                      <span className="truncate">{dp.name}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {dp.setFiles.length} .als
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
