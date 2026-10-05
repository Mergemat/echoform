import { HardDrives } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { posthog } from "@/lib/posthog";
import type { DiskUsage } from "@/lib/types";
import { plural } from "@/lib/utils";
import { formatSize } from "./timeline-utils";

// ── Fetch helpers ────────────────────────────────────────────────────

async function fetchDiskUsage(projectId: string): Promise<DiskUsage> {
  const res = await fetch(`/api/projects/${projectId}/disk-usage`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Failed to load disk usage");
  }
  return data as DiskUsage;
}

async function pruneSaves(
  projectId: string,
  olderThanDays: number
): Promise<number> {
  const res = await fetch(`/api/projects/${projectId}/prune`, {
    body: JSON.stringify({ olderThanDays }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Prune failed");
  }
  return data.deletedCount as number;
}

async function compactStorage(projectId: string): Promise<number> {
  const res = await fetch(`/api/projects/${projectId}/compact-storage`, {
    method: "POST",
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Compaction failed");
  }
  return data.deletedCount as number;
}

// ── Main panel ───────────────────────────────────────────────────────

const PRUNE_OPTIONS = [
  { days: 7, label: "7d" },
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

export function DiskUsagePanel({ projectId }: { projectId: string }) {
  return <ProjectDiskUsagePanel key={projectId} projectId={projectId} />;
}

function ProjectDiskUsagePanel({ projectId }: { projectId: string }) {
  const [state, setState] = useState({
    actionMsg: null as string | null,
    compacting: false,
    confirmAction: null as
      | { kind: "compact" }
      | { days: number; kind: "prune" }
      | null,
    error: null as string | null,
    loading: false,
    open: false,
    pruning: false,
    usage: null as DiskUsage | null,
  });
  const {
    actionMsg,
    compacting,
    confirmAction,
    error,
    loading,
    open,
    pruning,
    usage,
  } = state;

  const load = useCallback(async () => {
    setState((current) => ({ ...current, error: null, loading: true }));
    void fetchDiskUsage(projectId)
      .then((data) => {
        setState((current) => ({ ...current, usage: data }));
      })
      .catch((err) => {
        setState((current) => ({
          ...current,
          error: err instanceof Error ? err.message : "Failed",
        }));
      })
      .finally(() => {
        setState((current) => ({ ...current, loading: false }));
      });
  }, [projectId]);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      posthog.capture("storage_panel_opened");
    }
    setState((current) => ({
      ...current,
      actionMsg: next ? current.actionMsg : null,
      open: next,
    }));
    if (next && !usage) {
      load();
    }
  };

  const handlePrune = async (days: number) => {
    setState((current) => ({
      ...current,
      actionMsg: null,
      confirmAction: null,
      pruning: true,
    }));
    void pruneSaves(projectId, days)
      .then(async (deleted) => {
        posthog.capture("auto_saves_pruned", {
          deleted_count: deleted,
          older_than_days: days,
        });
        const nextActionMsg =
          deleted === 0
            ? `Nothing to remove older than ${days} days.`
            : `Removed ${plural(deleted, "checkpoint")}.`;
        const fresh = await fetchDiskUsage(projectId);
        setState((current) => ({
          ...current,
          actionMsg: nextActionMsg,
          usage: fresh,
        }));
      })
      .catch((err) => {
        setState((current) => ({
          ...current,
          actionMsg: err instanceof Error ? err.message : "Prune failed",
        }));
      })
      .finally(() => {
        setState((current) => ({ ...current, pruning: false }));
      });
  };

  const handleCompact = async () => {
    setState((current) => ({
      ...current,
      actionMsg: null,
      compacting: true,
      confirmAction: null,
    }));
    void compactStorage(projectId)
      .then(async (deleted) => {
        posthog.capture("storage_compacted", {
          deleted_count: deleted,
        });
        const nextActionMsg =
          deleted === 0
            ? "Nothing to thin out."
            : `Removed ${plural(deleted, "checkpoint")}.`;
        const fresh = await fetchDiskUsage(projectId);
        setState((current) => ({
          ...current,
          actionMsg: nextActionMsg,
          usage: fresh,
        }));
      })
      .catch((err) => {
        setState((current) => ({
          ...current,
          actionMsg: err instanceof Error ? err.message : "Compaction failed",
        }));
      })
      .finally(() => {
        setState((current) => ({ ...current, compacting: false }));
      });
  };

  const busy = compacting || pruning;
  const eligible = usage?.eligibleAutoSaveCount ?? 0;

  return (
    <>
      <Popover onOpenChange={handleOpenChange} open={open}>
        <PopoverTrigger asChild>
          <Button size="default" type="button" variant="outline">
            <HardDrives size={15} />
            Storage
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-[340px] p-0">
          <div className="space-y-4 p-4">
            {loading && !usage && (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full rounded-md" />
                <Skeleton className="h-6 w-2/3 rounded-md" />
              </div>
            )}
            {error && (
              <div
                className="rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive"
                role="alert"
              >
                {error}
              </div>
            )}

            {usage && (
              <>
                <div>
                  <div className="font-semibold text-[20px] tabular-nums tracking-tight">
                    {formatSize(usage.blobStorageBytes)}
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
                    used by {usage.totalSaveCount} checkpoints. Files that don't
                    change between saves are stored only once.
                  </p>
                </div>

                <div className="space-y-2 border-border border-t pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-[12px]">
                        Thin out history
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
                        Keeps everything from the last 24 hours, then one
                        checkpoint per hour, day, and week.
                      </p>
                    </div>
                    <Button
                      disabled={busy || eligible === 0}
                      onClick={() =>
                        setState((current) => ({
                          ...current,
                          actionMsg: null,
                          confirmAction: { kind: "compact" },
                          open: false,
                        }))
                      }
                      size="xs"
                      type="button"
                      variant="secondary"
                    >
                      {compacting ? "Thinning…" : "Thin out"}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="font-medium text-[12px]">
                      Remove older than
                    </span>
                    <div className="flex gap-1">
                      {PRUNE_OPTIONS.map((opt) => (
                        <Button
                          disabled={busy || usage.autoSaveCount === 0}
                          key={opt.days}
                          onClick={() =>
                            setState((current) => ({
                              ...current,
                              actionMsg: null,
                              confirmAction: { days: opt.days, kind: "prune" },
                              open: false,
                            }))
                          }
                          size="xs"
                          type="button"
                          variant="ghost"
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    The latest and first checkpoint of each set, and any
                    checkpoint that is pinned, named, has a note or a preview,
                    are always kept. Your Ableton project is never touched.
                  </p>
                  {actionMsg && (
                    <div className="text-[12px] text-foreground" role="status">
                      {actionMsg}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog
        onOpenChange={(nextOpen) => {
          if (!(nextOpen || busy)) {
            setState((current) => ({
              ...current,
              confirmAction: null,
            }));
          }
        }}
        open={confirmAction !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove older checkpoints for good?</DialogTitle>
            <DialogDescription className="leading-relaxed">
              {confirmAction?.kind === "compact"
                ? `This removes up to ${plural(eligible, "checkpoint")} that fall between the hourly, daily, and weekly ones it keeps.`
                : confirmAction
                  ? `This removes checkpoints older than ${confirmAction.days} days that aren't protected.`
                  : null}{" "}
              They can't be restored afterwards. Protected checkpoints and your
              Ableton project stay untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() =>
                setState((current) => ({
                  ...current,
                  confirmAction: null,
                }))
              }
              variant="ghost"
            >
              Keep them
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (confirmAction?.kind === "compact") {
                  void handleCompact();
                } else if (confirmAction) {
                  void handlePrune(confirmAction.days);
                }
              }}
              variant="destructive"
            >
              Remove checkpoints
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
