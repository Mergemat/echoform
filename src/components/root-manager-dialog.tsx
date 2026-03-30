import { ArrowsClockwise, FolderSimple, Trash } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { useStore } from "@/lib/store";

/** Show only the meaningful tail of a path, replacing ~/Library/Mobile Documents/com~apple~CloudDocs with iCloud */
function shortenPath(p: string): string {
  let s = p;
  const parts = s.split("/");
  if (parts.length >= 3 && parts[1] === "Users") {
    const home = `/Users/${parts[2]}`;
    if (s.startsWith(`${home}/`)) {
      s = `~${s.slice(home.length)}`;
    }
  }
  s = s.replace("~/Library/Mobile Documents/com~apple~CloudDocs", "~/iCloud");
  return s;
}

function formatRelative(iso: string | null): string {
  if (!iso) {
    return "Never";
  }
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
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
    (state) => state.rootSuggestionsLoaded
  );
  const projects = useStore((state) => state.projects);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsLoading = open && !rootSuggestionsLoaded;

  const watchPath = (value: string) => {
    const nextPath = value.trim();
    if (!nextPath) {
      return;
    }
    sendDaemonCommand({ type: "add-root", path: nextPath });
    sendDaemonCommand({
      type: "discover-root-suggestions",
    });
  };

  const handlePickFolder = async () => {
    if (!window.echoform?.pickFolder) {
      toast.error("Folder picker is only available in the desktop app.");
      return;
    }

    try {
      const selectedPath = await window.echoform.pickFolder();
      if (!selectedPath) {
        return;
      }
      watchPath(selectedPath);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to open folder picker";
      toast.error(message);
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    if (rootSuggestionsLoaded) {
      return;
    }
    fetchTimerRef.current = setTimeout(() => {
      sendDaemonCommand({ type: "discover-root-suggestions" });
    }, 150);

    return () => {
      if (fetchTimerRef.current) {
        clearTimeout(fetchTimerRef.current);
        fetchTimerRef.current = null;
      }
    };
  }, [open, rootSuggestionsLoaded]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-0 border-white/[0.08] bg-[#111215] p-0 sm:max-w-3xl">
        <DialogHeader className="border-white/[0.06] border-b px-5 pt-5 pb-4">
          <DialogTitle className="font-semibold text-[15px] text-white/90">
            Watch my folders
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 p-5 md:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-[15px] text-white/85">
                    Add a folder
                  </div>
                  <div className="mt-0.5 text-white/40 text-xs">
                    Echoform watches all projects inside your folders.
                  </div>
                </div>
                <Button
                  className="rounded-lg text-[11px]"
                  onClick={() => sendDaemonCommand({ type: "sync-roots" })}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <ArrowsClockwise size={14} />
                  Sync now
                </Button>
              </div>

              <div className="mt-3">
                <Button
                  className="rounded-lg"
                  onClick={() => {
                    void handlePickFolder();
                  }}
                  type="button"
                  variant="secondary"
                >
                  <FolderSimple size={14} />
                  Choose folder
                </Button>
              </div>
            </section>

            <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="font-medium text-[15px] text-white/85">
                Suggested folders
              </div>
              <div className="mt-1 text-white/40 text-xs">
                Based on common Ableton and iCloud locations. Nothing is watched
                until you say so.
              </div>

              <div className="mt-3 space-y-2">
                {rootSuggestions.length === 0 ? (
                  suggestionsLoading ? (
                    <div className="rounded-lg border border-white/[0.08] border-dashed px-3 py-4 text-center text-[11px] text-white/30">
                      Looking for likely music folders...
                    </div>
                  ) : (
                    <div className="rounded-lg border border-white/[0.08] border-dashed px-3 py-4 text-center text-[11px] text-white/30">
                      No obvious folders found right now.
                    </div>
                  )
                ) : (
                  rootSuggestions.map((suggestion) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                      key={suggestion.path}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[13px] text-white/75">
                          {shortenPath(suggestion.path)}
                        </div>
                        <div className="mt-1 text-white/35 text-xs">
                          {suggestion.projectCount} project
                          {suggestion.projectCount === 1 ? "" : "s"}
                        </div>
                      </div>
                      <Button
                        className="rounded-lg text-xs"
                        onClick={() => {
                          sendDaemonCommand({
                            type: "add-root",
                            path: suggestion.path,
                          });
                          sendDaemonCommand({
                            type: "discover-root-suggestions",
                          });
                        }}
                        size="sm"
                        type="button"
                        variant="secondary"
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
                <div className="font-medium text-[15px] text-white/85">
                  Watched folders
                </div>
                <div className="mt-0.5 text-white/40 text-xs">
                  {roots.length} folder{roots.length === 1 ? "" : "s"},{" "}
                  {
                    projects.filter((project) => project.rootIds.length > 0)
                      .length
                  }{" "}
                  projects found
                </div>
              </div>
              <Badge className="rounded-md text-[11px]" variant="secondary">
                {roots.length} watching
              </Badge>
            </div>

            <div className="mt-3 space-y-2">
              {roots.length === 0 ? (
                <div className="rounded-lg border border-white/[0.08] border-dashed px-3 py-4 text-center text-[11px] text-white/30">
                  Add a folder to start protecting your projects automatically.
                </div>
              ) : (
                roots.map((root) => (
                  <div
                    className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                    key={root.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[13px] text-white/75">
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
                        aria-label={`Remove ${root.name}`}
                        className="rounded-md"
                        onClick={() => {
                          sendDaemonCommand({
                            type: "remove-root",
                            rootId: root.id,
                          });
                          sendDaemonCommand({
                            type: "discover-root-suggestions",
                          });
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
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
