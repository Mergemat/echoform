import { cn } from '@/lib/utils';
import type { Idea, Save } from '@/lib/types';
import { CaretDown, CaretRight, GitFork } from '@phosphor-icons/react';

export function BranchCard({
  idea,
  fromSave,
  depth,
  isCurrent,
  isFocused,
  isCollapsed,
  saveCount,
  onToggleCollapse,
}: {
  idea: Idea;
  fromSave: Save | null;
  depth: number;
  isCurrent: boolean;
  isFocused: boolean;
  isCollapsed: boolean;
  saveCount: number;
  onToggleCollapse: () => void;
}) {
  const lineLeft = 16 + depth * 20;

  return (
    <button
      type="button"
      onClick={onToggleCollapse}
      className={cn(
        'w-full text-left transition-colors group',
        isFocused ? 'bg-white/[0.04]' : 'bg-transparent hover:bg-white/[0.02]',
      )}
    >
      {/* Main row */}
      <div
        className="flex items-center gap-2 py-2.5 pr-4"
        style={{ paddingLeft: `${lineLeft}px` }}
      >
        {/* Branch dot + connector */}
        <div className="relative flex items-center shrink-0">
          {depth > 0 && (
            <GitFork size={10} className="text-white/15 mr-0.5" weight="bold" />
          )}
          <div
            className={cn(
              'size-2.5 rounded-full border',
              isCurrent
                ? 'bg-emerald-400/80 border-emerald-400/40'
                : isFocused
                  ? 'bg-white/30 border-white/20'
                  : 'bg-white/10 border-white/10',
            )}
          />
        </div>

        {/* Branch info */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className={cn(
              'text-[12px] font-medium truncate',
              isFocused ? 'text-white/80' : 'text-white/40',
            )}
          >
            {idea.name}
          </span>
          {isCurrent && (
            <span className="text-[9px] uppercase tracking-[0.12em] text-emerald-400/60 shrink-0">
              current
            </span>
          )}
          <span
            className={cn(
              'text-[10px] tabular-nums shrink-0',
              isFocused ? 'text-white/25' : 'text-white/15',
            )}
          >
            {saveCount} {saveCount === 1 ? 'save' : 'saves'}
          </span>
        </div>

        {/* Expand/collapse chevron */}
        <div className="shrink-0">
          {isCollapsed ? (
            <CaretRight
              size={11}
              className="text-white/20 group-hover:text-white/40 transition-colors"
            />
          ) : (
            <CaretDown
              size={11}
              className="text-white/20 group-hover:text-white/40 transition-colors"
            />
          )}
        </div>
      </div>

      {/* Fork origin subtitle */}
      {fromSave && (
        <div
          className={cn(
            'text-[10px] pb-2 -mt-1',
            isFocused ? 'text-white/25' : 'text-white/15',
          )}
          style={{ paddingLeft: `${lineLeft + 22}px` }}
        >
          forked from <span className="font-medium">{fromSave.label}</span>
        </div>
      )}
    </button>
  );
}
