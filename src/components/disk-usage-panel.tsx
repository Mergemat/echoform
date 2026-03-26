import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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

async function compactStorage(projectId: string): Promise<number> {
  const res = await fetch(`/api/projects/${projectId}/compact-storage`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Compaction failed');
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
  const size = 52;
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = totalBytes > 0 ? Math.min(usedBytes / totalBytes, 1) : 0;
  const offset = circumference * (1 - ratio);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0 -rotate-90"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-white/[0.06]"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-white/40 transition-all duration-500"
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
      <span className="text-[11px] text-white/35">{label}</span>
      <span
        className={cn(
          'text-[11px] font-mono tabular-nums',
          dim ? 'text-white/30' : 'text-white/60',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Horizontal bar chart showing per-save snapshot sizes. */
function SaveSizeChart({ saves }: { saves: DiskUsageSave[] }) {
  if (saves.length === 0) return null;
  const maxBytes = Math.max(...saves.map((s) => s.snapshotBytes), 1);

  return (
    <div className="space-y-[3px]">
      {saves.map((s) => {
        const pct = (s.snapshotBytes / maxBytes) * 100;
        return (
          <div
            key={s.id}
            className="group flex items-center gap-2"
            title={`${s.label} — ${formatSize(s.snapshotBytes)} @ ${formatDateTime(s.createdAt)}`}
          >
            <span
              className={cn(
                'text-[9px] w-[52px] truncate shrink-0 transition-colors',
                s.auto
                  ? 'text-white/20 group-hover:text-white/35'
                  : 'text-white/35 group-hover:text-white/50',
              )}
            >
              {s.label}
            </span>
            <div className="flex-1 h-[5px] bg-white/[0.04] rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  s.auto ? 'bg-white/15' : 'bg-white/35',
                )}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
            <span className="text-[9px] font-mono text-white/20 w-[38px] text-right shrink-0 tabular-nums group-hover:text-white/40 transition-colors">
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
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export function DiskUsagePanel({ projectId }: { projectId: string }) {
  const [usage, setUsage] = useState<DiskUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
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
    if (!next) setActionMsg(null);
  };

  const handlePrune = async (days: number) => {
    setPruning(true);
    setActionMsg(null);
    try {
      const deleted = await pruneSaves(projectId, days);
      setActionMsg(
        deleted === 0
          ? `No auto-saves older than ${days}d.`
          : `Pruned ${deleted} auto-save${deleted !== 1 ? 's' : ''}.`,
      );
      const fresh = await fetchDiskUsage(projectId);
      setUsage(fresh);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Prune failed');
    } finally {
      setPruning(false);
    }
  };

  const handleCompact = async () => {
    setCompacting(true);
    setActionMsg(null);
    try {
      const deleted = await compactStorage(projectId);
      setActionMsg(
        deleted === 0
          ? 'No auto-saves were eligible for compaction.'
          : `Compacted ${deleted} auto-save${deleted !== 1 ? 's' : ''}.`,
      );
      const fresh = await fetchDiskUsage(projectId);
      setUsage(fresh);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Compaction failed');
    } finally {
      setCompacting(false);
    }
  };

  const dedupPct =
    usage && usage.totalSnapshotBytes > 0
      ? Math.round((usage.dedupSavings / usage.totalSnapshotBytes) * 100)
      : 0;

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
        className="w-[320px] p-0 bg-[#111114] border-white/[0.08] rounded-xl overflow-hidden"
      >
        <div className="p-4 space-y-4">
          {loading && !usage && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-8 w-2/3 rounded-lg" />
            </div>
          )}
          {error && (
            <div className="text-[11px] text-red-400/70 bg-red-400/[0.06] rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {usage && (
            <>
              {/* Hero: ring + primary stat */}
              <div className="flex items-center gap-4">
                <UsageRing
                  usedBytes={usage.blobStorageBytes}
                  totalBytes={usage.totalSnapshotBytes}
                />
                <div>
                  <div className="text-[20px] font-semibold text-white/85 tabular-nums leading-tight tracking-tight">
                    {formatSize(usage.blobStorageBytes)}
                  </div>
                  <div className="text-[10px] text-white/30 mt-0.5">
                    on disk
                    {dedupPct > 0 && (
                      <span className="text-white/20">
                        {' '}
                        &middot; {dedupPct}% saved by dedup
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="space-y-1.5 pt-1">
                <StatRow label="Total saves" value={usage.totalSaveCount} />
                <StatRow
                  label="Auto-saves"
                  value={usage.autoSaveCount}
                />
                <StatRow
                  label="Manual saves"
                  value={usage.manualSaveCount}
                />
                <StatRow
                  label="Dedup savings"
                  value={formatSize(usage.dedupSavings)}
                  dim
                />
                <StatRow
                  label="Compactable"
                  value={usage.eligibleAutoSaveCount}
                  dim
                />
                <StatRow
                  label="Largest auto-save"
                  value={formatSize(usage.largestAutoSaveBytes)}
                  dim
                />
                <StatRow
                  label="Oldest auto-save"
                  value={
                    usage.oldestAutoSaveAt
                      ? formatDateTime(usage.oldestAutoSaveAt)
                      : '-'
                  }
                  dim
                />
              </div>

              {/* Per-save chart */}
              {usage.saves.length > 0 && (
                <div className="pt-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[9px] uppercase tracking-wider text-white/25 font-medium">
                      Saves
                    </span>
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="flex items-center gap-1 text-[9px] text-white/20">
                        <span className="inline-block size-1.5 rounded-full bg-white/35" />
                        manual
                      </span>
                      <span className="flex items-center gap-1 text-[9px] text-white/20">
                        <span className="inline-block size-1.5 rounded-full bg-white/15" />
                        auto
                      </span>
                    </div>
                  </div>
                  <SaveSizeChart saves={usage.saves} />
                </div>
              )}

              {/* Compact + Prune */}
              <div className="pt-1 border-t border-white/[0.06]">
                <div className="flex items-center justify-between pt-3">
                  <span className="text-[10px] text-white/30">
                    Retention compaction
                  </span>
                  <button
                    type="button"
                    disabled={
                      compacting ||
                      pruning ||
                      usage.eligibleAutoSaveCount === 0
                    }
                    onClick={handleCompact}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded-md transition-colors',
                      'text-white/30 hover:text-white/60 hover:bg-white/[0.06]',
                      'disabled:opacity-30 disabled:pointer-events-none',
                    )}
                  >
                    {compacting ? 'Compacting...' : 'Compact auto-saves'}
                  </button>
                </div>
                <div className="text-[9px] text-white/15 mt-1.5">
                  Keeps all last-24h auto-saves, then one per hour/day/week.
                </div>
                <div className="flex items-center justify-between pt-3">
                  <span className="text-[10px] text-white/30">
                    Prune auto-saves older than
                  </span>
                  <div className="flex gap-1">
                    {PRUNE_OPTIONS.map((opt) => (
                      <button
                        key={opt.days}
                        type="button"
                        disabled={
                          pruning || compacting || usage.autoSaveCount === 0
                        }
                        onClick={() => handlePrune(opt.days)}
                        className={cn(
                          'text-[10px] px-2 py-0.5 rounded-md transition-colors',
                          'text-white/30 hover:text-white/60 hover:bg-white/[0.06]',
                          'disabled:opacity-30 disabled:pointer-events-none',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {actionMsg && (
                  <div className="text-[10px] text-white/40 mt-1.5">
                    {actionMsg}
                  </div>
                )}
                <div className="text-[9px] text-white/15 mt-2">
                  Head and idea-base saves are never pruned.
                </div>
              </div>

              {/* Refresh */}
              <button
                type="button"
                onClick={load}
                className="text-[10px] text-white/20 hover:text-white/40 transition-colors"
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
