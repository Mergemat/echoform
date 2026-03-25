import { cn } from '@/lib/utils';
import type { Save } from '@/lib/types';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { formatSizeDelta } from './timeline-utils';

export function GroupCard({
  saves,
  expanded,
  onToggle,
}: {
  saves: Save[];
  groupKey: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const totalDelta = saves.reduce(
    (sum, s) => sum + (s.changes?.sizeDelta ?? 0),
    0,
  );
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full text-left py-2.5 pr-4 pl-3 flex items-center gap-2 hover:bg-white/[0.02] transition-all duration-150 border-l-2 border-transparent',
      )}
    >
      {expanded ? (
        <CaretDown size={10} className="text-white/25 shrink-0" />
      ) : (
        <CaretRight size={10} className="text-white/25 shrink-0" />
      )}
      <span className="text-[10px] text-white/25 uppercase tracking-wider font-medium">
        {saves.length} auto saves
      </span>
      {totalDelta !== 0 && (
        <span
          className={cn(
            'text-[10px] font-mono tabular-nums',
            totalDelta > 0 ? 'text-emerald-400/35' : 'text-red-400/35',
          )}
        >
          {formatSizeDelta(totalDelta)}
        </span>
      )}
    </button>
  );
}
