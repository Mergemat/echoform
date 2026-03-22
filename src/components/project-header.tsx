import { useState } from 'react';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { DotsThreeIcon, TrashSimple, Waveform } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { DiskUsagePanel } from '@/components/disk-usage-panel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ProjectHeader() {
  const project = useStore((s) => s.selectedProject());
  const send = useStore((s) => s.send);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!project) return null;

  const currentIdea = project.ideas.find((i) => i.id === project.currentIdeaId);
  const headSave = project.saves.find((s) => s.id === currentIdea?.headSaveId);
  const detachedSave = project.detachedRestore
    ? project.saves.find((s) => s.id === project.detachedRestore?.saveId)
    : null;

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
      <div className="flex items-center gap-3 min-w-0">
        <Waveform size={16} className="text-white/30 shrink-0" weight="bold" />
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium text-white/80 truncate">
            {project.name}
          </h2>
          <div className="flex items-center gap-1.5 text-[10px] text-white/25 mt-0.5">
            <span className="truncate font-mono">{project.activeSetPath}</span>
            {currentIdea && (
              <>
                <span>•</span>
                <span className="truncate">
                  {project.detachedRestore
                    ? `restored from ${detachedSave?.label ?? currentIdea.name}`
                    : currentIdea.name}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5 text-[11px]">
          <div
            className={cn(
              'size-1.5 rounded-full',
              project.watching ? 'bg-emerald-400 animate-pulse' : 'bg-white/20',
            )}
          />
          <span
            className={cn(
              project.watching ? 'text-emerald-400/70' : 'text-white/25',
            )}
          >
            {project.watching ? 'Watching' : 'Paused'}
          </span>
        </div>
        {headSave && (
          <div className="text-[10px] text-white/20 font-mono">
            {headSave.metadata.fileCount} files
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-white/35 hover:text-white/70"
              aria-label="Project actions"
            >
              <DotsThreeIcon size={16} weight="bold" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => {
                event.preventDefault();
                setConfirmOpen(true);
              }}
            >
              <TrashSimple size={14} data-icon="inline-start" />
              Remove From Ablegit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DiskUsagePanel projectId={project.id} />
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove tracked project?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes <span className="font-medium">{project.name}</span>{' '}
              from Ablegit&apos;s database and stops watching it. Your Ableton
              project folder and files stay on disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                send({ type: 'delete-project', projectId: project.id });
                setConfirmOpen(false);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
