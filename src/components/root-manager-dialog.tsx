import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { sendDaemonCommand } from '@/lib/daemon-client';
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
  const rootSuggestionsLoaded = useStore(
    (state) => state.rootSuggestionsLoaded,
  );
  const projects = useStore((state) => state.projects);
  const [path, setPath] = useState('');
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsLoading = open && !rootSuggestionsLoaded;

  useEffect(() => {
    if (!open) return;
    if (rootSuggestionsLoaded) return;
    fetchTimerRef.current = setTimeout(() => {
      sendDaemonCommand({ type: 'discover-root-suggestions' });
    }, 150);

    return () => {
      if (fetchTimerRef.current) {
        clearTimeout(fetchTimerRef.current);
        fetchTimerRef.current = null;
      }
    };
  }, [open, rootSuggestionsLoaded]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 bg-[#111215] border-white/[0.08]">
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <DialogTitle className="text-[15px] font-semibold text-white/90">
            Watch my folders
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[1.1fr_0.9fr] p-5">
          <>
              <div className="space-y-5">
                <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[15px] font-medium text-white/85">
                        Add a folder
                      </div>
                      <div className="text-xs text-white/40 mt-0.5">
                        Ablegit watches all projects inside your folders.
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-lg text-[11px]"
                      onClick={() => sendDaemonCommand({ type: 'sync-roots' })}
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
                      className="rounded-lg text-[13px]"
                    />
                    <Button
                      type="button"
                      className="rounded-lg"
                      onClick={() => {
                        const nextPath = path.trim();
                        if (!nextPath) return;
                        sendDaemonCommand({ type: 'add-root', path: nextPath });
                        sendDaemonCommand({
                          type: 'discover-root-suggestions',
                        });
                        setPath('');
                      }}
                    >
                      <Plus size={14} />
                      Watch
                    </Button>
                  </div>
                </section>

                <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
                  <div className="text-[15px] font-medium text-white/85">
                    Suggested folders
                  </div>
                  <div className="mt-1 text-xs text-white/40">
                    Based on common Ableton and iCloud locations. Nothing is
                    watched until you say so.
                  </div>

                  <div className="mt-3 space-y-2">
                    {rootSuggestions.length === 0 ? (
                      suggestionsLoading ? (
                        <div className="rounded-lg border border-dashed border-white/[0.08] px-3 py-4 text-[11px] text-white/30 text-center">
                          Looking for likely music folders...
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-white/[0.08] px-3 py-4 text-[11px] text-white/30 text-center">
                          No obvious folders found right now.
                        </div>
                      )
                    ) : (
                      rootSuggestions.map((suggestion) => (
                        <div
                          key={suggestion.path}
                          className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[13px] text-white/75 font-medium">
                              {shortenPath(suggestion.path)}
                            </div>
                            <div className="mt-1 text-xs text-white/35">
                              {suggestion.projectCount} project
                              {suggestion.projectCount === 1 ? '' : 's'}
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="rounded-lg text-xs"
                            onClick={() => {
                              sendDaemonCommand({
                                type: 'add-root',
                                path: suggestion.path,
                              });
                              sendDaemonCommand({
                                type: 'discover-root-suggestions',
                              });
                            }}
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

              <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-medium text-white/85">
                      Watched folders
                    </div>
                    <div className="text-xs text-white/40 mt-0.5">
                      {roots.length} folder{roots.length === 1 ? '' : 's'},{' '}
                      {
                        projects.filter((project) => project.rootIds.length > 0)
                          .length
                      }{' '}
                      projects found
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[11px] rounded-md">
                    {roots.length} watching
                  </Badge>
                </div>

                <div className="mt-3 space-y-2">
                  {roots.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/[0.08] px-3 py-4 text-[11px] text-white/30 text-center">
                      Add a folder to start protecting your projects
                      automatically.
                    </div>
                  ) : (
                    roots.map((root) => (
                      <div
                        key={root.id}
                        className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[13px] text-white/75 font-medium">
                              {shortenPath(root.path)}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/35">
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
                            className="rounded-md"
                            onClick={() => {
                              sendDaemonCommand({
                                type: 'remove-root',
                                rootId: root.id,
                              });
                              sendDaemonCommand({
                                type: 'discover-root-suggestions',
                              });
                            }}
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
          </>
        </div>
      </DialogContent>
    </Dialog>
  );
}
