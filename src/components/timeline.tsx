import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Project, Save, Idea, ChangeSummary } from "@/lib/types";
import { useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

function formatTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSizeDelta(bytes: number): string {
  const abs = Math.abs(bytes);
  const sign = bytes >= 0 ? "+" : "\u2212";
  if (abs < 1024) return `${sign}${abs}B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(0)}K`;
  return `${sign}${(abs / 1024 / 1024).toFixed(1)}M`;
}

function changeBadge(changes: ChangeSummary | undefined) {
  if (!changes) return null;
  const { addedFiles, removedFiles, modifiedFiles, sizeDelta } = changes;
  const notAls = (f: string) => !f.toLowerCase().endsWith(".als");
  const added = addedFiles.filter(notAls).length;
  const removed = removedFiles.filter(notAls).length;
  const modified = modifiedFiles.filter(notAls).length;
  const total = added + removed + modified;
  if (total === 0 && sizeDelta === 0) return null;
  return { sizeDelta, added, removed, modified };
}

type SavesByIdea = { idea: Idea; saves: Save[] };

function groupByIdea(project: Project): SavesByIdea[] {
  const map = new Map<string, SavesByIdea>();
  for (const idea of project.ideas) {
    map.set(idea.id, { idea, saves: [] });
  }
  for (const save of project.saves) {
    const group = map.get(save.ideaId);
    if (group) group.saves.push(save);
  }
  return Array.from(map.values()).filter((g) => g.saves.length > 0);
}

// ── Layout constants ────────────────────────────────────────────────

const PAD = 16;           // horizontal padding
const DOT_W = 48;         // width allocated per dot
const GAP = 20;           // gap between dot centers
const STEP = DOT_W + GAP; // center-to-center distance
const BADGE_H = 13;       // height of size delta badge row
const DOT_SIZE = 12;      // dot diameter
const DOT_CENTER_Y = BADGE_H + 4 + DOT_SIZE / 2; // badge + gap + half dot = ~23
const LANE_H = 50;        // total lane height

// ── SaveDot ─────────────────────────────────────────────────────────

function SaveDot({ save, isSelected, isHead, onSelect }: {
  save: Save;
  isSelected: boolean;
  isHead: boolean;
  onSelect: (id: string) => void;
}) {
  const badge = changeBadge(save.changes);

  return (
    <button
      type="button"
      onClick={() => onSelect(save.id)}
      className="group/dot flex flex-col items-center gap-1 shrink-0"
      style={{ width: DOT_W }}
      title={save.label}
    >
      {/* Size delta badge */}
      {badge && badge.sizeDelta !== 0 ? (
        <div className={cn(
          "text-[9px] font-mono leading-none tabular-nums",
          badge.sizeDelta > 0 ? "text-emerald-400/50" : "text-red-400/50",
        )} style={{ height: BADGE_H }}>
          {formatSizeDelta(badge.sizeDelta)}
        </div>
      ) : (
        <div style={{ height: BADGE_H }} />
      )}
      {/* Dot */}
      <div
        className={cn(
          "rounded-full border-2 transition-all",
          isSelected
            ? "border-white bg-white scale-125"
            : isHead
              ? "border-emerald-400 bg-emerald-400/30 group-hover/dot:bg-emerald-400/60"
              : save.auto
                ? "border-white/20 bg-white/5 group-hover/dot:border-white/40"
                : "border-white/40 bg-white/10 group-hover/dot:border-white/60",
          badge && (badge.added + badge.removed + badge.modified >= 3 || Math.abs(badge.sizeDelta) > 10 * 1024 * 1024) &&
            !isSelected && "ring-1 ring-white/10",
        )}
        style={{ width: DOT_SIZE, height: DOT_SIZE }}
      />
      {/* Time label */}
      <div className={cn(
        "text-[10px] leading-tight text-center truncate transition-colors",
        isSelected ? "text-white" : "text-white/30 group-hover/dot:text-white/50",
      )} style={{ maxWidth: DOT_W }}>
        {formatTime(save.createdAt)}
      </div>
    </button>
  );
}

// ── Virtualized horizontal lane ─────────────────────────────────────

function IdeaLane({ group, isCurrentIdea, selectedSaveId }: {
  group: SavesByIdea;
  isCurrentIdea: boolean;
  selectedSaveId: string | null;
}) {
  const selectSave = useStore((s) => s.selectSave);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(group.saves.length);

  const count = group.saves.length;
  const totalWidth = PAD * 2 + count * DOT_W + (count - 1) * GAP;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => STEP, []),
    horizontal: true,
    overscan: 15,
  });

  // Scroll to far right on mount + when new saves arrive
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Always scroll to end on mount
    el.scrollLeft = el.scrollWidth;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (count > prevCount.current) {
      prevCount.current = count;
      const el = scrollRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollLeft = el.scrollWidth;
        });
      }
    }
  }, [count]);

  // Scroll selected into view
  useEffect(() => {
    if (!selectedSaveId) return;
    const idx = group.saves.findIndex((s) => s.id === selectedSaveId);
    if (idx === -1) return;
    const el = scrollRef.current;
    if (!el) return;
    const itemLeft = PAD + idx * STEP;
    const itemRight = itemLeft + DOT_W;
    if (itemLeft < el.scrollLeft) {
      el.scrollTo({ left: itemLeft - PAD, behavior: "smooth" });
    } else if (itemRight > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: itemRight - el.clientWidth + PAD, behavior: "smooth" });
    }
  }, [selectedSaveId, group.saves]);

  // line from center of first dot to center of last dot
  const lineLeft = PAD + DOT_W / 2;
  const lineRight = PAD + (count - 1) * STEP + DOT_W / 2;

  return (
    <div>
      {/* Idea label */}
      <div className="px-4 py-1.5 flex items-center gap-2">
        <div className={cn(
          "size-1.5 rounded-full",
          isCurrentIdea ? "bg-emerald-400" : "bg-white/20",
        )} />
        <span className={cn(
          "text-[11px] font-medium uppercase tracking-wider",
          isCurrentIdea ? "text-white/50" : "text-white/20",
        )}>
          {group.idea.name}
        </span>
        <span className="text-[10px] text-white/15">
          {count} saves
        </span>
      </div>

      {/* Scroll container */}
      <div
        ref={scrollRef}
        className="overflow-x-auto scrollbar-none"
      >
        <div className="relative" style={{ width: totalWidth, height: LANE_H }}>
          {/* Continuous connector line */}
          {count > 1 && (
            <div
              className="absolute bg-white/10"
              style={{
                left: lineLeft,
                width: lineRight - lineLeft,
                top: DOT_CENTER_Y,
                height: 1,
              }}
            />
          )}

          {/* Virtualized dots */}
          {virtualizer.getVirtualItems().map((vItem) => {
            const save = group.saves[vItem.index]!;
            return (
              <div
                key={save.id}
                className="absolute top-0"
                style={{
                  left: PAD + vItem.index * STEP,
                  width: DOT_W,
                  height: LANE_H,
                }}
              >
                <SaveDot
                  save={save}
                  isSelected={save.id === selectedSaveId}
                  isHead={save.id === group.idea.headSaveId}
                  onSelect={selectSave}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Timeline ────────────────────────────────────────────────────────

export function Timeline() {
  const project = useStore((s) => s.selectedProject());
  const selectedSaveId = useStore((s) => s.selectedSaveId);

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center text-white/15 text-[13px]">
        Select a project to see its timeline
      </div>
    );
  }

  if (project.saves.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-white/20 text-[13px]">
        <div className="text-center">
          <div className="text-white/30 mb-1">No saves yet</div>
          <div className="text-[11px] text-white/15">
            {project.watching
              ? "Watching for changes... saves will appear automatically"
              : "Enable watching to auto-save on changes"}
          </div>
        </div>
      </div>
    );
  }

  const groups = groupByIdea(project);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        {groups.map((group) => (
          <IdeaLane
            key={group.idea.id}
            group={group}
            isCurrentIdea={group.idea.id === project.currentIdeaId}
            selectedSaveId={selectedSaveId}
          />
        ))}
      </div>
    </div>
  );
}
