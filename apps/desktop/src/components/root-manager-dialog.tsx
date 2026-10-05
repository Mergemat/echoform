import {
  ArrowsClockwise,
  FolderSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { posthog } from "@/lib/posthog";
import { useStore } from "@/lib/store";
import type { TrackedRoot } from "@/lib/types";
import { plural, shortenPath, timeAgo } from "@/lib/utils";

function WatchedFolderRow({ root }: { root: TrackedRoot }) {
  const projectCount = useStore(
    (state) =>
      state.projects.filter((project) => project.rootIds.includes(root.id))
        .length
  );
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px]" title={root.path}>
            {shortenPath(root.path)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {plural(projectCount, "project")} · scanned{" "}
            {timeAgo(root.lastScannedAt).replace("Just now", "just now")}
          </div>
        </div>
        {!confirming && (
          <Button
            aria-label={`Stop watching ${root.name}`}
            className="text-muted-foreground"
            onClick={() => setConfirming(true)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <X size={14} />
          </Button>
        )}
      </div>
      {root.lastError && (
        <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-destructive">
          <WarningCircle className="mt-px shrink-0" size={12} />
          {root.lastError}
        </div>
      )}
      {confirming && (
        <div className="mt-2.5 rounded-md bg-muted p-2.5 text-[12px]">
          <p className="text-muted-foreground leading-relaxed">
            Echoform stops looking for new projects here. Projects it already
            found keep their history and are still recorded.
          </p>
          <div className="mt-2 flex justify-end gap-1.5">
            <Button
              onClick={() => setConfirming(false)}
              size="xs"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                posthog.capture("root_removed", { context: "manager" });
                void sendDaemonCommand({
                  rootId: root.id,
                  type: "remove-root",
                });
                void sendDaemonCommand({ type: "discover-root-suggestions" });
              }}
              size="xs"
              type="button"
              variant="destructive"
            >
              Stop watching
            </Button>
          </div>
        </div>
      )}
    </li>
  );
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
  const unwatchedSuggestions = rootSuggestions.filter(
    (suggestion) => !roots.some((root) => root.path === suggestion.path)
  );

  useEffect(() => {
    if (open && !rootSuggestionsLoaded) {
      void sendDaemonCommand({ type: "discover-root-suggestions" });
    }
  }, [open, rootSuggestionsLoaded]);

  const watchPath = (path: string, source: "picker" | "suggestion") => {
    const nextPath = path.trim();
    if (!nextPath) {
      return;
    }
    posthog.capture("root_added", { context: "manager", source });
    void sendDaemonCommand({ path: nextPath, type: "add-root" });
    void sendDaemonCommand({ type: "discover-root-suggestions" });
  };

  const handlePickFolder = async () => {
    if (!window.echoform?.pickFolder) {
      toast.error("The folder picker is only available in the desktop app.");
      return;
    }
    try {
      const selectedPath = await window.echoform.pickFolder();
      if (selectedPath) {
        watchPath(selectedPath, "picker");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't open folder picker"
      );
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Watched folders</DialogTitle>
          <DialogDescription>
            Echoform finds Ableton projects inside these folders and records
            every save. Your files are never moved or changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section>
            {roots.length === 0 ? (
              <p className="rounded-lg border border-border border-dashed px-3 py-4 text-center text-[12px] text-muted-foreground">
                No folders yet. Add the folder you keep projects in.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {roots.map((root) => (
                  <WatchedFolderRow key={root.id} root={root} />
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Button
                onClick={() => void handlePickFolder()}
                size="sm"
                type="button"
                variant="secondary"
              >
                <FolderSimple size={14} />
                Choose folder
              </Button>
              {roots.length > 0 && (
                <Button
                  className="text-muted-foreground"
                  onClick={() => void sendDaemonCommand({ type: "sync-roots" })}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <ArrowsClockwise size={14} />
                  Rescan
                </Button>
              )}
            </div>
          </section>

          {unwatchedSuggestions.length > 0 && (
            <section>
              <h3 className="mb-2 font-medium text-[12px] text-muted-foreground">
                Suggested
              </h3>
              <ul className="space-y-1.5">
                {unwatchedSuggestions.map((suggestion) => (
                  <li
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
                    key={suggestion.path}
                  >
                    <div className="min-w-0">
                      <div
                        className="truncate text-[13px]"
                        title={suggestion.path}
                      >
                        {shortenPath(suggestion.path)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {plural(suggestion.projectCount, "project")}
                      </div>
                    </div>
                    <Button
                      onClick={() => watchPath(suggestion.path, "suggestion")}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Watch
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
