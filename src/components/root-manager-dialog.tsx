import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  ArrowsClockwise,
  FolderSimple,
  Trash,
} from '@phosphor-icons/react';

/** Show only the meaningful tail of a path, replacing ~/Library/Mobile Documents/com~apple~CloudDocs with iCloud */
function shortenPath(p: string): string {
  let s = p;
  const parts = s.split('/');
  if (parts.length >= 3 && parts[1] === 'Users') {
    const home = `/Users/${parts[2]}`;
    if (s.startsWith(home + '/')) s = '~' + s.slice(home.length);
  }
  s = s.replace('~/Library/Mobile Documents/com~apple~CloudDocs', '~/iCloud');
  return s;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RootManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const roots = useStore((state) => state.roots);
  const rootSuggestions = useStore((state) => state.rootSuggestions);
  const projects = useStore((state) => state.projects);
  const send = useStore((state) => state.send);
  const [path, setPath] = useState('');

  useEffect(() => {
    if (!open) return;
    send({ type: 'sync-roots' });
    send({ type: 'discover-root-suggestions' });
  }, [open, send]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Watch my folders</DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <section className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white/85">
                    Add a folder
                  </div>
                  <div className="text-xs text-white/45">
                    Ablegit watches all projects inside your folders.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => send({ type: 'sync-roots' })}
                >
                  <ArrowsClockwise size={14} />
                  Sync now
                </Button>
              </div>

              <div className="mt-3 flex gap-2">
                <Input
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  placeholder="/Users/you/Music/Ableton/projects"
                />
                <Button
                  type="button"
                  onClick={() => {
                    const nextPath = path.trim();
                    if (!nextPath) return;
                    send({ type: 'add-root', path: nextPath });
                    setPath('');
                  }}
                >
                  <Plus size={14} />
                  Watch
                </Button>
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-medium text-white/85">
                Suggested folders
              </div>
              <div className="mt-1 text-xs text-white/45">
                Based on common Ableton and iCloud locations. Nothing is watched
                until you say so.
              </div>

              <div className="mt-3 space-y-2">
                {rootSuggestions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-xs text-white/35">
                    No obvious folders found right now.
                  </div>
                ) : (
                  rootSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.path}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-white/80">
                          {shortenPath(suggestion.path)}
                        </div>
                        <div className="mt-1 text-xs text-white/40">
                          {suggestion.projectCount} project
                          {suggestion.projectCount === 1 ? '' : 's'}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          send({ type: 'add-root', path: suggestion.path })
                        }
                      >
                        <FolderSimple size={14} />
                        Watch
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white/85">
                  Watched folders
                </div>
                <div className="text-xs text-white/45">
                  {roots.length} folder{roots.length === 1 ? '' : 's'},{' '}
                  {
                    projects.filter((project) => project.rootIds.length > 0)
                      .length
                  }{' '}
                  projects found
                </div>
              </div>
              <Badge variant="secondary">{roots.length} watching</Badge>
            </div>

            <div className="mt-3 space-y-2">
              {roots.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-xs text-white/35">
                  Add a folder to start protecting your projects automatically.
                </div>
              ) : (
                roots.map((root) => (
                  <div
                    key={root.id}
                    className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-white/80">
                          {shortenPath(root.path)}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/40">
                          <span>
                            Scanned {formatRelative(root.lastScannedAt)}
                          </span>
                          {root.lastError && (
                            <span className="text-red-300/70">
                              {root.lastError}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          send({ type: 'remove-root', rootId: root.id })
                        }
                        aria-label={`Remove ${root.name}`}
                      >
                        <Trash size={14} />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
