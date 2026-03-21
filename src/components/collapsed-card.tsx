import { cn } from '@/lib/utils';
import type { Save } from '@/lib/types';
import { useMemo } from 'react';
import {
  formatTime,
  formatSizeDelta,
  buildChips,
  type Chip,
} from './timeline-utils';
import { TrackThumbnail } from './track-thumbnail';
import { Badge } from '@/components/ui/badge';

export function CollapsedCard({
  save,
  isSelected,
  isHead,
  onClick,
}: {
  save: Save;
  isSelected: boolean;
  isHead: boolean;
  onClick: () => void;
}) {
  const chips = useMemo(() => buildChips(save), [save]);
  const MAX_CHIPS = 4;
  const visible = chips.slice(0, MAX_CHIPS);
  const overflow = chips.length - MAX_CHIPS;
  const hasRow2 = save.setDiff !== undefined || save.changes !== undefined;
  let fallbackText: string | null = null;
  if (hasRow2 && chips.length === 0) {
    const delta = save.changes?.sizeDelta ?? 0;
    fallbackText =
      delta !== 0
        ? `Set file updated ${formatSizeDelta(delta)}`
        : 'No file changes';
  }
  const chipColor = (kind: Chip['kind']) => {
    if (kind === 'add')
      return 'text-emerald-400/70 bg-emerald-400/10 border-emerald-400/20';
    if (kind === 'remove')
      return 'text-red-400/70 bg-red-400/10 border-red-400/20';
    if (kind === 'change')
      return 'text-amber-400/70 bg-amber-400/10 border-amber-400/20';
    return 'text-white/40 bg-white/[0.04] border-white/10';
  };
  const sizeDelta = save.changes?.sizeDelta;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-2.5 flex flex-col gap-1 transition-colors',
        isSelected
          ? 'bg-white/[0.06] border-l-2 border-white/50'
          : 'border-l-2 border-transparent hover:bg-white/[0.03]',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={cn(
            'shrink-0 size-2 rounded-full',
            isSelected
              ? 'bg-white'
              : isHead
                ? 'bg-emerald-400'
                : save.auto
                  ? 'bg-white/20'
                  : 'bg-white/40',
          )}
        />
        <span className="text-[10px] font-mono text-white/30 shrink-0">
          {formatTime(save.createdAt)}
        </span>
        <span
          className={cn(
            'text-[12px] truncate flex-1',
            isSelected ? 'text-white/90' : 'text-white/50',
          )}
        >
          {save.label}
        </span>
        {sizeDelta !== undefined && sizeDelta !== 0 && (
          <span
            className={cn(
              'text-[10px] font-mono tabular-nums shrink-0',
              sizeDelta > 0 ? 'text-emerald-400/50' : 'text-red-400/50',
            )}
          >
            {formatSizeDelta(sizeDelta)}
          </span>
        )}
        <Badge
          variant="secondary"
          className={cn(
            'text-[9px] uppercase tracking-wider px-1 py-px rounded-sm shrink-0 h-auto border-transparent',
            save.auto
              ? 'text-white/20 bg-white/[0.04]'
              : 'text-white/30 bg-white/[0.06]',
          )}
        >
          {save.auto ? 'auto' : 'manual'}
        </Badge>
      </div>
      {hasRow2 && (
        <div className="pl-4 flex flex-wrap items-center gap-1">
          {fallbackText ? (
            <span className="text-[10px] text-white/20">{fallbackText}</span>
          ) : (
            <>
              {visible.map((chip) => (
                <Badge
                  key={chip.label}
                  variant="outline"
                  className={cn(
                    'text-[10px] px-1.5 py-px rounded h-auto font-mono',
                    chipColor(chip.kind),
                  )}
                >
                  {chip.label}
                </Badge>
              ))}
              {overflow > 0 && (
                <span className="text-[10px] text-white/25">
                  +{overflow} more
                </span>
              )}
            </>
          )}
        </div>
      )}
      {save.trackSummary && save.trackSummary.length > 0 && (
        <TrackThumbnail tracks={save.trackSummary} className="pl-4 pr-2" />
      )}
    </button>
  );
}
