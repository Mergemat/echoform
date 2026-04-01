import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { posthog } from "@/lib/posthog";
import type { DiskUsage, DiskUsageSave } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  formatDateTime,
  formatSize,
  getSaveDisplayTitle,
} from "./timeline-utils";

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
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ olderThanDays }),
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

// ── Sub-components ───────────────────────────────────────────────────

/** SVG arc ring showing dedup efficiency. */
function UsageRing({
  usedBytes,
  totalBytes,
}: {
  usedBytes: number;
  totalBytes: number;
}) {
  const size = 60;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = totalBytes > 0 ? Math.min(usedBytes / totalBytes, 1) : 0;
  const offset = circumference * (1 - ratio);

  return (
    <svg
      className="shrink-0 -rotate-90"
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
    >
      <circle
        className="text-white/[0.06]"
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeWidth={stroke}
      />
      <circle
        className="text-white/40 transition-all duration-500"
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth={stroke}
      />
    </svg>
  );
}

function StatRow({
  label,
  value,
  dim,
}: {
  label: string;
  value: string | number;
  dim?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-white/35 text-xs">{label}</span>
      <span
        className={cn(
          "font-mono text-xs tabular-nums",
          dim ? "text-white/30" : "text-white/60"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Horizontal bar chart showing per-save snapshot sizes. */
function SaveSizeChart({ saves }: { saves: DiskUsageSave[] }) {
  if (saves.length === 0) {
    return null;
  }
  const maxBytes = Math.max(...saves.map((s) => s.snapshotBytes), 1);

  return (
    <div className="space-y-[3px]">
      {saves.map((s) => {
        const pct = (s.snapshotBytes / maxBytes) * 100;
        return (
          <div
            className="group flex items-center gap-2"
            key={s.id}
            title={`${getSaveDisplayTitle(s)} — ${formatSize(s.snapshotBytes)} @ ${formatDateTime(s.createdAt)}`}
          >
            <span
              className={cn(
                "w-[86px] shrink-0 truncate text-[10px] transition-colors",
                s.auto
                  ? "text-white/20 group-hover:text-white/35"
                  : "text-white/35 group-hover:text-white/50"
              )}
            >
              {getSaveDisplayTitle(s, { compact: true })}
            </span>
            <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-white/[0.04]">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  s.auto ? "bg-white/15" : "bg-white/35"
                )}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
            <span className="w-[38px] shrink-0 text-right font-mono text-[10px] text-white/20 tabular-nums transition-colors group-hover:text-white/40">
              {formatSize(s.snapshotBytes)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────

const PRUNE_OPTIONS = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export function DiskUsagePanel({ projectId }: { projectId: string }) {
  const [state, setState] = useState({
    actionMsg: null as string | null,
    compacting: false,
    error: null as string | null,
    loading: false,
    open: false,
    pruning: false,
    usage: null as DiskUsage | null,
  });
  const { actionMsg, compacting, error, loading, open, pruning, usage } = state;

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
            ? `No auto-saves older than ${days}d.`
            : `Pruned ${deleted} auto-save${deleted === 1 ? "" : "s"}.`;
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
    }));
    void compactStorage(projectId)
      .then(async (deleted) => {
        posthog.capture("storage_compacted", {
          deleted_count: deleted,
        });
        const nextActionMsg =
          deleted === 0
            ? "No auto-saves were eligible for compaction."
            : `Compacted ${deleted} auto-save${deleted === 1 ? "" : "s"}.`;
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

  const dedupPct =
    usage && usage.totalSnapshotBytes > 0
      ? Math.round((usage.dedupSavings / usage.totalSnapshotBytes) * 100)
      : 0;

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button
          className="h-auto px-1 py-0 font-mono text-[11px] text-white/25 tabular-nums hover:text-white/50"
          size="sm"
          variant="ghost"
        >
          {usage ? formatSize(usage.blobStorageBytes) : "Storage"}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[360px] overflow-hidden rounded-xl border-white/[0.08] bg-[#111114] p-0"
      >
        <div className="space-y-4 p-4">
          {loading && !usage && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-8 w-2/3 rounded-lg" />
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-red-400/[0.06] px-3 py-2 text-[11px] text-red-400/70">
              {error}
            </div>
          )}

          {usage && (
            <>
              {/* Hero: ring + primary stat */}
              <div className="flex items-center gap-4">
                <UsageRing
                  totalBytes={usage.totalSnapshotBytes}
                  usedBytes={usage.blobStorageBytes}
                />
                <div>
                  <div className="font-semibold text-[20px] text-white/85 tabular-nums leading-tight tracking-tight">
                    {formatSize(usage.blobStorageBytes)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-white/30">
                    on disk
                    {dedupPct > 0 && (
                      <span className="text-white/20">
                        {" "}
                        &middot; {dedupPct}% saved by dedup
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="space-y-1.5 pt-1">
                <StatRow label="Total saves" value={usage.totalSaveCount} />
                <StatRow label="Auto-saves" value={usage.autoSaveCount} />
                <StatRow label="Manual saves" value={usage.manualSaveCount} />
                <StatRow
                  dim
                  label="Dedup savings"
                  value={formatSize(usage.dedupSavings)}
                />
                <StatRow
                  dim
                  label="Compactable"
                  value={usage.eligibleAutoSaveCount}
                />
                <StatRow
                  dim
                  label="Largest auto-save"
                  value={formatSize(usage.largestAutoSaveBytes)}
                />
                <StatRow
                  dim
                  label="Oldest auto-save"
                  value={
                    usage.oldestAutoSaveAt
                      ? formatDateTime(usage.oldestAutoSaveAt)
                      : "-"
                  }
                />
              </div>

              {/* Per-save chart */}
              {usage.saves.length > 0 && (
                <div className="pt-1">
                  <div className="mb-2 flex items-center gap-3">
                    <span className="font-medium text-[10px] text-white/25 uppercase tracking-wider">
                      Saves
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="flex items-center gap-1 text-[10px] text-white/20">
                        <span className="inline-block size-1.5 rounded-full bg-white/35" />
                        manual
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-white/20">
                        <span className="inline-block size-1.5 rounded-full bg-white/15" />
                        auto
                      </span>
                    </div>
                  </div>
                  <SaveSizeChart saves={usage.saves} />
                </div>
              )}

              {/* Compact + Prune */}
              <div className="border-white/[0.06] border-t pt-1">
                <div className="flex items-center justify-between pt-3">
                  <span className="text-[11px] text-white/30">
                    Retention compaction
                  </span>
                  <button
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                      "text-white/30 hover:bg-white/[0.06] hover:text-white/60",
                      "disabled:pointer-events-none disabled:opacity-30"
                    )}
                    disabled={
                      compacting || pruning || usage.eligibleAutoSaveCount === 0
                    }
                    onClick={handleCompact}
                    type="button"
                  >
                    {compacting ? "Compacting..." : "Compact auto-saves"}
                  </button>
                </div>
                <div className="mt-1.5 text-[10px] text-white/15">
                  Keeps all last-24h auto-saves, then one per hour/day/week.
                </div>
                <div className="flex items-center justify-between pt-3">
                  <span className="text-[11px] text-white/30">
                    Prune auto-saves older than
                  </span>
                  <div className="flex gap-1">
                    {PRUNE_OPTIONS.map((opt) => (
                      <button
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                          "text-white/30 hover:bg-white/[0.06] hover:text-white/60",
                          "disabled:pointer-events-none disabled:opacity-30"
                        )}
                        disabled={
                          pruning || compacting || usage.autoSaveCount === 0
                        }
                        key={opt.days}
                        onClick={() => handlePrune(opt.days)}
                        type="button"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {actionMsg && (
                  <div className="mt-1.5 text-[11px] text-white/40">
                    {actionMsg}
                  </div>
                )}
                <div className="mt-2 text-[10px] text-white/15">
                  Latest and base saves are never pruned.
                </div>
              </div>

              {/* Refresh */}
              <button
                className="text-[11px] text-white/20 transition-colors hover:text-white/40"
                onClick={load}
                type="button"
              >
                Refresh
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
