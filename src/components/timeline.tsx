// timeline.tsx — vertical card timeline (skeleton, filled in chunks below)
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { basename, extname } from '@/lib/path';
import { Button } from '@/components/ui/button';
import type { Project, Save, Idea } from '@/lib/types';
import { useRef, useState, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowCounterClockwise,
  TrashSimple,
  GitFork,
  CaretDown,
  CaretRight,
} from '@phosphor-icons/react';

// ── Utilities ────────────────────────────────────────────────────────
function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function formatSizeDelta(bytes: number): string {
  const abs = Math.abs(bytes);
  const sign = bytes >= 0 ? '+' : '\u2212';
  if (abs < 1024) return `${sign}${abs}B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(0)}K`;
  return `${sign}${(abs / 1024 / 1024).toFixed(1)}M`;
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
const AUDIO_EXT = new Set([
  '.aif',
  '.aiff',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.wav',
]);
function isAudio(p: string) {
  return AUDIO_EXT.has(extname(p).toLowerCase());
}
function isAls(p: string) {
  return extname(p).toLowerCase() === '.als';
}

// ── Chip builders ────────────────────────────────────────────────────
type Chip = { label: string; kind: 'neutral' | 'add' | 'remove' | 'change' };
function buildChips(save: Save): Chip[] {
  const chips: Chip[] = [];
  const sd = save.setDiff;
  if (sd) {
    if (sd.tempoChange)
      chips.push({
        label: `${sd.tempoChange.from}\u2192${sd.tempoChange.to} bpm`,
        kind: 'change',
      });
    if (sd.timeSignatureChange)
      chips.push({
        label: `${sd.timeSignatureChange.from}\u2192${sd.timeSignatureChange.to}`,
        kind: 'change',
      });
    const addByType: Record<string, number> = {};
    const remByType: Record<string, number> = {};
    for (const t of sd.addedTracks)
      addByType[t.type] = (addByType[t.type] ?? 0) + 1;
    for (const t of sd.removedTracks)
      remByType[t.type] = (remByType[t.type] ?? 0) + 1;
    const TL: Record<string, string> = {
      midi: 'MIDI',
      audio: 'Audio',
      return: 'Return',
      group: 'Group',
    };
    for (const [type, count] of Object.entries(addByType))
      chips.push({ label: `+${count} ${TL[type] ?? type}`, kind: 'add' });
    for (const [type, count] of Object.entries(remByType))
      chips.push({
        label: `\u2212${count} ${TL[type] ?? type}`,
        kind: 'remove',
      });
    const renames = sd.modifiedTracks.filter((t) => t.renamedFrom);
    if (renames.length === 1)
      chips.push({
        label: `\u201c${renames[0]!.renamedFrom}\u201d\u2192\u201c${renames[0]!.name}\u201d`,
        kind: 'change',
      });
    else if (renames.length >= 2)
      chips.push({ label: `${renames.length} tracks renamed`, kind: 'change' });
    let deviceDelta = 0;
    for (const t of sd.modifiedTracks)
      deviceDelta += t.addedDevices.length - t.removedDevices.length;
    if (deviceDelta !== 0)
      chips.push({
        label: `${deviceDelta > 0 ? '+' : ''}${deviceDelta} device${Math.abs(deviceDelta) !== 1 ? 's' : ''}`,
        kind: deviceDelta > 0 ? 'add' : 'remove',
      });
    let clipDelta = 0;
    for (const t of sd.modifiedTracks) clipDelta += t.clipCountDelta;
    if (clipDelta !== 0)
      chips.push({
        label: `${clipDelta > 0 ? '+' : ''}${clipDelta} clip${Math.abs(clipDelta) !== 1 ? 's' : ''}`,
        kind: clipDelta > 0 ? 'add' : 'remove',
      });
    if (sd.modifiedTracks.some((t) => t.mixerChanges.length > 0))
      chips.push({ label: 'mixer changes', kind: 'neutral' });
  }
  if (save.changes) {
    const added = save.changes.addedFiles.filter((f) => !isAls(f));
    const removed = save.changes.removedFiles.filter((f) => !isAls(f));
    if (added.length > 0)
      chips.push({
        label: `+${added.length} file${added.length !== 1 ? 's' : ''}`,
        kind: 'add',
      });
    if (removed.length > 0)
      chips.push({
        label: `\u2212${removed.length} file${removed.length !== 1 ? 's' : ''}`,
        kind: 'remove',
      });
  }
  return chips;
}

// ── Auto-save grouping ───────────────────────────────────────────────
type DisplayItem =
  | { type: 'save'; save: Save }
  | { type: 'group'; saves: Save[]; key: string };

function isTrivialAutoSave(save: Save): boolean {
  if (!save.auto) return false;
  const sd = save.setDiff;
  if (sd) {
    if (sd.tempoChange || sd.timeSignatureChange) return false;
    if (
      sd.addedTracks.length ||
      sd.removedTracks.length ||
      sd.modifiedTracks.length
    )
      return false;
  }
  if (save.changes) {
    if (save.changes.addedFiles.filter((f) => !isAls(f)).length) return false;
    if (save.changes.removedFiles.filter((f) => !isAls(f)).length) return false;
  }
  return true;
}
function buildDisplayItems(
  saves: Save[],
  expandedGroups: Set<string>,
): DisplayItem[] {
  const items: DisplayItem[] = [];
  let i = 0;
  while (i < saves.length) {
    const save = saves[i]!;
    if (isTrivialAutoSave(save)) {
      const group: Save[] = [save];
      let j = i + 1;
      while (j < saves.length && isTrivialAutoSave(saves[j]!)) {
        group.push(saves[j]!);
        j++;
      }
      if (group.length >= 2) {
        const key = group[0]!.id;
        if (expandedGroups.has(key)) {
          for (const s of group) items.push({ type: 'save', save: s });
        } else items.push({ type: 'group', saves: group, key });
        i = j;
        continue;
      }
    }
    items.push({ type: 'save', save });
    i++;
  }
  return items;
}

// ── CollapsedCard ────────────────────────────────────────────────────
function CollapsedCard({
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
        <span
          className={cn(
            'text-[9px] uppercase tracking-wider px-1 py-px rounded shrink-0',
            save.auto
              ? 'text-white/20 bg-white/[0.04]'
              : 'text-white/30 bg-white/[0.06]',
          )}
        >
          {save.auto ? 'auto' : 'manual'}
        </span>
      </div>
      {hasRow2 && (
        <div className="pl-4 flex flex-wrap items-center gap-1">
          {fallbackText ? (
            <span className="text-[10px] text-white/20">{fallbackText}</span>
          ) : (
            <>
              {visible.map((chip) => (
                <span
                  key={chip.label}
                  className={cn(
                    'text-[10px] px-1.5 py-px rounded border font-mono',
                    chipColor(chip.kind),
                  )}
                >
                  {chip.label}
                </span>
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
    </button>
  );
}

// ── ExpandedCard ─────────────────────────────────────────────────────
function ExpandedCard({
  save,
  idea,
  isHead,
  projectId,
  onClose,
}: {
  save: Save;
  idea: Idea | undefined;
  isHead: boolean;
  projectId: string;
  onClose: () => void;
}) {
  const send = useStore((s) => s.send);
  const [labelVal, setLabelVal] = useState(save.label);
  const [noteVal, setNoteVal] = useState(save.note);
  const [showIdeaForm, setShowIdeaForm] = useState(false);
  const [ideaName, setIdeaName] = useState('');
  const [computing, setComputing] = useState(false);

  const commitEdit = () =>
    send({
      type: 'update-save',
      projectId,
      saveId: save.id,
      note: noteVal,
      label: labelVal,
    });
  const handleGoBack = () =>
    send({ type: 'go-back-to', projectId, saveId: save.id });
  const handleDelete = () =>
    send({ type: 'delete-save', projectId, saveId: save.id });
  const handleCreateIdea = () => {
    if (!ideaName.trim()) return;
    send({
      type: 'create-idea',
      projectId,
      fromSaveId: save.id,
      name: ideaName.trim(),
    });
    setIdeaName('');
    setShowIdeaForm(false);
  };
  const handleCompute = async () => {
    setComputing(true);
    try {
      await fetch(`/api/projects/${projectId}/saves/${save.id}/changes`, {
        method: 'POST',
      });
    } finally {
      setComputing(false);
    }
  };

  const changes = save.changes;
  const addedAudio =
    changes?.addedFiles.filter((f) => !isAls(f) && isAudio(f)) ?? [];
  const removedAudio =
    changes?.removedFiles.filter((f) => !isAls(f) && isAudio(f)) ?? [];
  const addedOther =
    changes?.addedFiles.filter((f) => !isAls(f) && !isAudio(f)) ?? [];
  const removedOther =
    changes?.removedFiles.filter((f) => !isAls(f) && !isAudio(f)) ?? [];
  const modifiedOther =
    changes?.modifiedFiles.filter((f) => !isAls(f) && !isAudio(f)) ?? [];
  const TTRACK: Record<string, string> = {
    midi: 'MIDI',
    audio: 'Audio',
    return: 'Return',
    group: 'Group',
  };
  const sd = save.setDiff;

  return (
    <div className="px-4 pb-4 pt-1 space-y-3 border-l-2 border-white/50 bg-white/[0.03]">
      <div className="flex items-start gap-2 pt-1">
        <div className="flex-1 min-w-0">
          <input
            value={labelVal}
            onChange={(e) => setLabelVal(e.target.value)}
            onBlur={commitEdit}
            className="bg-transparent border-b border-white/10 focus:border-white/30 text-[13px] text-white/90 font-medium w-full outline-none pb-0.5"
          />
          <div className="text-[10px] text-white/25 mt-1">
            {formatDateTime(save.createdAt)}
            {idea ? ` · ${idea.name}` : ''}
            {isHead ? ' · head' : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-white/20 hover:text-white/50 text-[11px] mt-0.5"
        >
          ✕
        </button>
      </div>

      <textarea
        value={noteVal}
        onChange={(e) => setNoteVal(e.target.value)}
        onBlur={commitEdit}
        placeholder="Note..."
        className="w-full bg-white/[0.03] border border-white/[0.07] rounded px-2.5 py-2 text-[11px] text-white/60 resize-none outline-none focus:border-white/15 placeholder:text-white/15 min-h-[56px]"
      />

      <div className="flex gap-2 text-[10px]">
        {[
          { label: 'Files', value: save.metadata.fileCount },
          { label: 'Audio', value: save.metadata.audioFiles },
          { label: 'Size', value: formatSize(save.metadata.sizeBytes) },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-white/[0.03] rounded px-2 py-1 border border-white/[0.05]"
          >
            <div className="text-white/20 uppercase tracking-wider">
              {item.label}
            </div>
            <div className="text-white/60 font-medium mt-0.5">{item.value}</div>
          </div>
        ))}
      </div>

      {sd && (
        <div className="space-y-1.5 text-[11px]">
          {sd.tempoChange && (
            <div className="flex items-center gap-1.5">
              <span className="text-white/25">Tempo</span>
              <span className="font-mono text-white/40">
                {sd.tempoChange.from}
              </span>
              <span className="text-white/15">→</span>
              <span className="font-mono text-white/60">
                {sd.tempoChange.to}
              </span>
              <span className="text-white/25">bpm</span>
            </div>
          )}
          {sd.timeSignatureChange && (
            <div className="flex items-center gap-1.5">
              <span className="text-white/25">Time sig</span>
              <span className="font-mono text-white/40">
                {sd.timeSignatureChange.from}
              </span>
              <span className="text-white/15">→</span>
              <span className="font-mono text-white/60">
                {sd.timeSignatureChange.to}
              </span>
            </div>
          )}
          {sd.addedTracks.length > 0 && (
            <div>
              <div className="text-[10px] text-emerald-400/60 uppercase tracking-wider mb-0.5">
                New tracks
              </div>
              {sd.addedTracks.map((t) => (
                <div
                  key={`add-${t.type}-${t.name}`}
                  className="pl-2 flex items-center gap-1.5 text-white/40"
                >
                  <span className="text-[9px] text-white/20 bg-white/[0.06] px-1 py-px rounded uppercase">
                    {TTRACK[t.type] ?? t.type}
                  </span>
                  <span className="truncate">{t.name}</span>
                </div>
              ))}
            </div>
          )}
          {sd.removedTracks.length > 0 && (
            <div>
              <div className="text-[10px] text-red-400/60 uppercase tracking-wider mb-0.5">
                Removed tracks
              </div>
              {sd.removedTracks.map((t) => (
                <div
                  key={`rem-${t.type}-${t.name}`}
                  className="pl-2 flex items-center gap-1.5 text-white/30"
                >
                  <span className="text-[9px] text-white/15 bg-white/[0.04] px-1 py-px rounded uppercase">
                    {TTRACK[t.type] ?? t.type}
                  </span>
                  <span className="truncate">{t.name}</span>
                </div>
              ))}
            </div>
          )}
          {sd.modifiedTracks.map((t) => (
            <div key={`mod-${t.type}-${t.name}`} className="pl-2 space-y-0.5">
              <div className="flex items-center gap-1.5 text-white/40">
                <span className="text-[9px] text-white/20 bg-white/[0.06] px-1 py-px rounded uppercase">
                  {TTRACK[t.type] ?? t.type}
                </span>
                <span className="truncate">{t.name}</span>
                {t.renamedFrom && (
                  <span className="text-white/20 text-[10px]">
                    (was "{t.renamedFrom}")
                  </span>
                )}
              </div>
              <div className="pl-2 space-y-px text-[10px] text-white/25">
                {t.addedDevices.length > 0 && (
                  <div className="text-emerald-400/50">
                    + {t.addedDevices.join(', ')}
                  </div>
                )}
                {t.removedDevices.length > 0 && (
                  <div className="text-red-400/50">
                    − {t.removedDevices.join(', ')}
                  </div>
                )}
                {t.clipCountDelta !== 0 && (
                  <div
                    className={
                      t.clipCountDelta > 0
                        ? 'text-emerald-400/50'
                        : 'text-red-400/50'
                    }
                  >
                    {t.clipCountDelta > 0 ? '+' : ''}
                    {t.clipCountDelta} clips
                  </div>
                )}
                {t.mixerChanges.length > 0 && (
                  <div>{t.mixerChanges.join(', ')}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {changes === undefined ? (
        <div>
          <div className="text-[11px] text-white/20 mb-1.5">No change data</div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCompute}
            disabled={computing}
          >
            {computing ? 'Computing...' : 'Compute changes'}
          </Button>
        </div>
      ) : addedAudio.length +
          removedAudio.length +
          addedOther.length +
          removedOther.length +
          modifiedOther.length >
        0 ? (
        <div className="space-y-1.5 bg-white/[0.02] rounded border border-white/[0.04] p-2">
          {addedAudio.length > 0 && (
            <div>
              <div className="text-[10px] text-emerald-400/60 uppercase tracking-wider mb-0.5">
                New audio
              </div>
              {addedAudio.map((f) => (
                <div
                  key={f}
                  className="text-[11px] font-mono text-white/40 pl-2 truncate"
                >
                  {basename(f)}
                </div>
              ))}
            </div>
          )}
          {removedAudio.length > 0 && (
            <div>
              <div className="text-[10px] text-red-400/60 uppercase tracking-wider mb-0.5">
                Removed audio
              </div>
              {removedAudio.map((f) => (
                <div
                  key={f}
                  className="text-[11px] font-mono text-white/30 pl-2 truncate"
                >
                  {basename(f)}
                </div>
              ))}
            </div>
          )}
          {addedOther.length + removedOther.length + modifiedOther.length >
            0 && (
            <div className="text-[11px] text-white/20">
              {[
                addedOther.length > 0 && `+${addedOther.length} files`,
                removedOther.length > 0 && `\u2212${removedOther.length} files`,
                modifiedOther.length > 0 && `~${modifiedOther.length} modified`,
              ]
                .filter(Boolean)
                .join(', ')}
            </div>
          )}
        </div>
      ) : null}

      {save.metadata.setFiles.length > 0 && (
        <div>
          <div className="text-[10px] text-white/20 uppercase tracking-wider mb-1">
            Set files
          </div>
          {save.metadata.setFiles.map((f) => (
            <div
              key={f}
              className={cn(
                'text-[10px] font-mono px-1.5 py-0.5 rounded truncate',
                f === save.metadata.activeSetPath
                  ? 'text-white/50 bg-white/[0.04]'
                  : 'text-white/20',
              )}
            >
              {f}
              {f === save.metadata.activeSetPath && (
                <span className="text-emerald-400/50 ml-1">active</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <Button variant="ghost" size="sm" onClick={handleGoBack}>
          <ArrowCounterClockwise size={13} data-icon="inline-start" /> Restore
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowIdeaForm(!showIdeaForm)}
        >
          <GitFork size={13} data-icon="inline-start" /> Branch
        </Button>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          <TrashSimple size={13} data-icon="inline-start" /> Delete
        </Button>
      </div>

      {showIdeaForm && (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded p-2.5 space-y-2">
          <input
            value={ideaName}
            onChange={(e) => setIdeaName(e.target.value)}
            placeholder="New idea name..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateIdea();
            }}
            className="bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1.5 text-[11px] text-white/70 w-full outline-none focus:border-white/15 placeholder:text-white/15"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreateIdea}
            disabled={!ideaName.trim()}
          >
            Create idea
          </Button>
        </div>
      )}
    </div>
  );
}

// ── GroupCard ────────────────────────────────────────────────────────
function GroupCard({
  saves,
  groupKey: _groupKey,
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
      className="w-full text-left px-4 py-2 flex items-center gap-2 hover:bg-white/[0.02] transition-colors border-l-2 border-transparent"
    >
      {expanded ? (
        <CaretDown size={10} className="text-white/20 shrink-0" />
      ) : (
        <CaretRight size={10} className="text-white/20 shrink-0" />
      )}
      <span className="text-[10px] text-white/20 uppercase tracking-wider">
        {saves.length} auto saves
      </span>
      {totalDelta !== 0 && (
        <span
          className={cn(
            'text-[10px] font-mono tabular-nums',
            totalDelta > 0 ? 'text-emerald-400/30' : 'text-red-400/30',
          )}
        >
          {formatSizeDelta(totalDelta)}
        </span>
      )}
    </button>
  );
}

// ── IdeaTabs ─────────────────────────────────────────────────────────
function IdeaTabs({
  project,
  activeIdeaId,
  onSelect,
}: {
  project: Project;
  activeIdeaId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.06] overflow-x-auto scrollbar-none shrink-0">
      {project.ideas.map((idea) => {
        const count = project.saves.filter((s) => s.ideaId === idea.id).length;
        const isActive = (activeIdeaId ?? project.currentIdeaId) === idea.id;
        return (
          <button
            key={idea.id}
            type="button"
            onClick={() => onSelect(idea.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] whitespace-nowrap transition-colors',
              isActive
                ? 'bg-white/[0.08] text-white/80'
                : 'text-white/30 hover:text-white/50 hover:bg-white/[0.04]',
            )}
          >
            <span>{idea.name}</span>
            <span
              className={cn(
                'text-[9px]',
                isActive ? 'text-white/30' : 'text-white/15',
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────
export function Timeline() {
  const project = useStore((s) => s.selectedProject());
  const selectedSaveId = useStore((s) => s.selectedSaveId);
  const activeIdeaId = useStore((s) => s.activeIdeaId);
  const toggleSave = useStore((s) => s.toggleSave);
  const setActiveIdea = useStore((s) => s.setActiveIdea);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const effectiveIdeaId = activeIdeaId ?? project?.currentIdeaId ?? null;

  const filteredSaves = useMemo(() => {
    if (!project || !effectiveIdeaId) return [];
    return project.saves
      .filter((s) => s.ideaId === effectiveIdeaId)
      .slice()
      .reverse();
  }, [project, effectiveIdeaId]);

  const displayItems = useMemo(
    () => buildDisplayItems(filteredSaves, expandedGroups),
    [filteredSaves, expandedGroups],
  );

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => 60, []),
    overscan: 8,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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
              ? 'Watching for changes...'
              : 'Enable watching to auto-save'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <IdeaTabs
        project={project}
        activeIdeaId={activeIdeaId}
        onSelect={setActiveIdea}
      />

      {/* Vertical timeline line + cards */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[22px] top-0 bottom-0 w-px bg-white/[0.06]" />

          <div
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const item = displayItems[vItem.index]!;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  {item.type === 'group' ? (
                    <GroupCard
                      saves={item.saves}
                      groupKey={item.key}
                      expanded={expandedGroups.has(item.key)}
                      onToggle={() => toggleGroup(item.key)}
                    />
                  ) : (
                    (() => {
                      const save = item.save;
                      const idea = project.ideas.find(
                        (i) => i.id === save.ideaId,
                      );
                      const isHead = idea?.headSaveId === save.id;
                      const isSelected = save.id === selectedSaveId;
                      if (isSelected) {
                        return (
                          <div>
                            <CollapsedCard
                              save={save}
                              isSelected
                              isHead={isHead}
                              onClick={() => toggleSave(save.id)}
                            />
                            <ExpandedCard
                              save={save}
                              idea={idea}
                              isHead={isHead}
                              projectId={project.id}
                              onClose={() => toggleSave(save.id)}
                            />
                          </div>
                        );
                      }
                      return (
                        <CollapsedCard
                          save={save}
                          isSelected={false}
                          isHead={isHead}
                          onClick={() => toggleSave(save.id)}
                        />
                      );
                    })()
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
