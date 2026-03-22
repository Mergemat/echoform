import { cn } from '@/lib/utils';
import type { Idea, Save } from '@/lib/types';

export function BranchCard({
  idea,
  fromSave,
  depth,
  isCurrent,
  isFocused,
}: {
  idea: Idea;
  fromSave: Save | null;
  depth: number;
  isCurrent: boolean;
  isFocused: boolean;
}) {
  return (
    <div
      className={cn(
        'px-4 py-2.5 transition-colors',
        isFocused ? 'bg-white/[0.035]' : 'bg-transparent opacity-65',
      )}
      style={{ paddingLeft: `${16 + depth * 28}px` }}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'size-2 rounded-sm border border-white/15',
            isCurrent ? 'bg-emerald-400/80' : 'bg-white/[0.08]',
          )}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-white/25">
              {depth === 0 ? 'Main Line' : 'Branch'}
            </span>
            <span className="text-[12px] font-medium text-white/75 truncate">
              {idea.name}
            </span>
            {isCurrent && (
              <span className="text-[10px] uppercase tracking-[0.12em] text-emerald-300/70">
                current
              </span>
            )}
          </div>
          {fromSave && (
            <div className="text-[10px] text-white/30 mt-0.5 truncate">
              forked from {fromSave.label}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
