import { cn } from '@/lib/utils';
import type { Save } from '@/lib/types';
import { useMemo } from 'react';
import { SpeakerHigh } from '@phosphor-icons/react';
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
  const MAX_CHIPS = 3;
  const visible = chips.slice(0, MAX_CHIPS);
  const overflow = chips.length - MAX_CHIPS;
  const hasChips = save.setDiff !== undefined || save.changes !== undefined;
  let fallbackText: string | null = null;
  if (hasChips && chips.length === 0) {
    const delta = save.changes?.sizeDelta ?? 0;
    fallbackText =
      delta !== 0
        ? `Set file updated ${formatSizeDelta(delta)}`
        : 'No file changes';
  }
  const chipColor = (kind: Chip['kind']) => {
    if (kind === 'add')
      return 'text-emerald-400/80 bg-emerald-400/10 border-emerald-400/15';
    if (kind === 'remove')
      return 'text-red-400/80 bg-red-400/10 border-red-400/15';
    if (kind === 'change')
      return 'text-amber-400/80 bg-amber-400/10 border-amber-400/15';
    return 'text-white/40 bg-white/[0.04] border-white/[0.06]';
  };
  const hasThumbnail = save.trackSummary && save.trackSummary.length > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left py-3 pr-4 pl-4 flex items-center gap-2.5 transition-all duration-150 min-h-[44px]',
        isSelected
          ? 'bg-white/[0.06] border-l-2 border-white/50'
          : 'border-l-2 border-transparent hover:bg-white/[0.03]',
      )}
    >
      {/* Dot */}
      <div
        className={cn(
          'shrink-0 size-2 rounded-full ring-2',
          isSelected
            ? 'bg-white ring-white/20'
            : isHead
              ? 'bg-emerald-400 ring-emerald-400/20'
              : save.auto
                ? 'bg-white/15 ring-white/[0.04]'
                : 'bg-white/40 ring-white/10',
        )}
      />

      {/* Time */}
      <span className="text-xs font-mono text-white/30 shrink-0 tabular-nums">
        {formatTime(save.createdAt)}
      </span>

      {/* Label + chips stacked tight */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={cn(
              'text-[13px] truncate leading-tight',
              isSelected ? 'text-white/90 font-medium' : 'text-white/55',
            )}
          >
            {save.label}
          </span>
          {!save.auto && (
            <Badge
              variant="secondary"
              className="text-[10px] uppercase tracking-widest px-1 py-0 rounded shrink-0 h-auto border-transparent text-emerald-400/60 bg-emerald-400/8 leading-tight"
            >
              saved
            </Badge>
          )}
        </div>
        {hasChips && (
          <div className="flex flex-wrap items-center gap-1">
            {fallbackText ? (
              <span className="text-[11px] text-white/20">{fallbackText}</span>
            ) : (
              <>
                {visible.map((chip) => (
                  <Badge
                    key={chip.label}
                    variant="outline"
                    className={cn(
                      'text-[10px] px-1 py-0 rounded h-auto font-mono leading-tight',
                      chipColor(chip.kind),
                    )}
                  >
                    {chip.label}
                  </Badge>
                ))}
                {overflow > 0 && (
                  <span className="text-[11px] text-white/20 ml-0.5">
                    +{overflow}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Track thumbnail — right-aligned */}
      {hasThumbnail && (
        <TrackThumbnail
          tracks={save.trackSummary!}
          className="shrink-0 ml-auto"
        />
      )}

      {/* Audio icon */}
      {save.previewStatus === 'ready' && (
        <SpeakerHigh
          size={11}
          className="shrink-0 text-white/20"
          weight="fill"
        />
      )}
    </button>
  );
}
