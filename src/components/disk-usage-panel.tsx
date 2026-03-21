import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { formatSize, formatDateTime } from './timeline-utils';
import type { DiskUsage, DiskUsageSave } from '@/lib/types';

// ── Fetch helpers ────────────────────────────────────────────────────

async function fetchDiskUsage(projectId: string): Promise<DiskUsage> {
  const res = await fetch(`/api/projects/${projectId}/disk-usage`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to load disk usage');
  return data as DiskUsage;
}

async function pruneSaves(
  projectId: string,
  olderThanDays: number,
): Promise<number> {
  const res = await fetch(`/api/projects/${projectId}/prune`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ olderThanDays }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Prune failed');
  return data.deletedCount as number;
}

// ── Sub-components ───────────────────────────────────────────────────

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white/[0.03] rounded px-2.5 py-1.5 border border-white/[0.05] min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-white/20 mb-0.5">
        {label}
      </div>
      <div className="text-[12px] font-medium text-white/70 tabular-nums truncate">
        {value}
      </div>
    </div>
  );
}

/** Horizontal bar chart showing per-save snapshot sizes. */
function SaveSizeBar({ saves }: { saves: DiskUsageSave[] }) {
  if (saves.length === 0) return null;
  const maxBytes = Math.max(...saves.map((s) => s.snapshotBytes), 1);

  return (
    <div className="space-y-px">
      {saves.map((s) => {
        const pct = (s.snapshotBytes / maxBytes) * 100;
        return (
          <div
            key={s.id}
            className="flex items-center gap-2 group"
            title={`${s.label} — ${formatSize(s.snapshotBytes)} @ ${formatDateTime(s.createdAt)}`}
          >
            <div className="w-[6px] shrink-0">
              <div
                className={cn(
                  'size-[5px] rounded-full',
                  s.auto ? 'bg-white/15' : 'bg-white/35',
                )}
              />
            </div>
            <div className="flex-1 h-[3px] bg-white/[0.04] rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  s.auto ? 'bg-white/20' : 'bg-white/40',
                )}
                style={{ width: `${Math.max(pct, 1)}%` }}
              />
            </div>
            <div className="text-[9px] font-mono text-white/25 w-[42px] text-right shrink-0 tabular-nums">
              {formatSize(s.snapshotBytes)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────

const PRUNE_OPTIONS = [
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

export function DiskUsagePanel({ projectId }: { projectId: string }) {
  const [usage, setUsage] = useState<DiskUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pruneMsg, setPruneMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDiskUsage(projectId);
      setUsage(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && !usage) load();
    if (!next) setPruneMsg(null);
  };

  const handlePrune = async (days: number) => {
    setPruning(true);
    setPruneMsg(null);
    try {
      const deleted = await pruneSaves(projectId, days);
      setPruneMsg(
        deleted === 0
          ? `No auto-saves older than ${days} days found.`
          : `Deleted ${deleted} auto-save${deleted !== 1 ? 's' : ''}.`,
      );
      const fresh = await fetchDiskUsage(projectId);
      setUsage(fresh);
    } catch (err) {
      setPruneMsg(err instanceof Error ? err.message : 'Prune failed');
    } finally {
      setPruning(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto px-1 py-0 text-[10px] text-white/25 hover:text-white/50 font-mono tabular-nums"
        >
          {usage ? formatSize(usage.blobStorageBytes) : 'Storage'}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[340px] p-0 bg-[#111114] border-white/[0.08]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
          <span className="text-[12px] font-medium text-white/70">Storage</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpen(false)}
            className="text-white/20 hover:text-white/50 size-5"
          >
            ✕
          </Button>
        </div>

        <div className="p-4 space-y-4">
          {loading && !usage && (
            <div className="space-y-1.5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {error && <div className="text-[11px] text-red-400/70">{error}</div>}

          {usage && (
            <>
              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-1.5">
                <StatBox
                  label="On disk"
                  value={formatSize(usage.blobStorageBytes)}
                />
                <StatBox label="Saves" value={usage.totalSaveCount} />
                <StatBox
                  label="Dedup saved"
                  value={formatSize(usage.dedupSavings)}
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <StatBox label="Auto-saves" value={usage.autoSaveCount} />
                <StatBox label="Manual saves" value={usage.manualSaveCount} />
              </div>

              {/* Per-save bar chart */}
              {usage.saves.length > 0 && (
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-white/20 mb-2">
                    Per-save snapshot size
                  </div>
                  <SaveSizeBar saves={usage.saves} />
                </div>
              )}

              {/* Prune section */}
              <Separator className="bg-white/[0.05]" />
              <div className="space-y-2">
                <div className="text-[9px] uppercase tracking-wider text-white/20">
                  Prune auto-saves older than
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRUNE_OPTIONS.map((opt) => (
                    <Button
                      key={opt.days}
                      variant="ghost"
                      size="sm"
                      disabled={pruning || usage.autoSaveCount === 0}
                      onClick={() => handlePrune(opt.days)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
                {pruneMsg && (
                  <div className="text-[10px] text-white/40">{pruneMsg}</div>
                )}
                <div className="text-[9px] text-white/20 leading-relaxed">
                  Head saves and idea base saves are never pruned.
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={load}
                className="text-[10px] text-white/20 hover:text-white/40 px-0 h-auto"
              >
                Refresh
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
