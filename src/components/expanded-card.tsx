import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { basename } from '@/lib/path';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import type { Save, Idea } from '@/lib/types';
import { useState } from 'react';
import {
  ArrowCounterClockwise,
  TrashSimple,
  GitFork,
  X,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { formatDateTime, formatSize, isAudio, isAls } from './timeline-utils';
import { TrackThumbnail } from './track-thumbnail';
import { SmartRestoreDialog } from './smart-restore-dialog';

const TTRACK: Record<string, string> = {
  midi: 'MIDI',
  audio: 'Audio',
  return: 'Return',
  group: 'Group',
};

export function ExpandedCard({
  save,
  idea,
  isHead,
  projectId,
  depth = 0,
  onClose,
}: {
  save: Save;
  idea: Idea | undefined;
  isHead: boolean;
  projectId: string;
  depth?: number;
  onClose: () => void;
}) {
  const send = useStore((s) => s.send);
  const [labelVal, setLabelVal] = useState(save.label);
  const [noteVal, setNoteVal] = useState(save.note);
  const [showIdeaForm, setShowIdeaForm] = useState(false);
  const [showSmartRestore, setShowSmartRestore] = useState(false);
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
  const sd = save.setDiff;

  return (
    <div
      className="pb-4 pt-1 pr-4 space-y-3 border-l-2 border-white/50 bg-white/[0.03]"
      style={{ paddingLeft: `${16 + depth * 28}px` }}
    >
      <div className="flex items-start gap-2 pt-1">
        <div className="flex-1 min-w-0">
          <Input
            value={labelVal}
            onChange={(e) => setLabelVal(e.target.value)}
            onBlur={commitEdit}
            className="bg-transparent border-0 border-b border-white/10 focus-visible:border-white/30 focus-visible:ring-0 rounded-none text-[13px] text-white/90 font-medium w-full px-0 pb-0.5 h-auto"
          />
          <div className="text-[10px] text-white/25 mt-1">
            {formatDateTime(save.createdAt)}
            {idea ? ` · ${idea.name}` : ''}
            {isHead ? ' · head' : ''}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="text-white/20 hover:text-white/50 mt-0.5"
        >
          <X size={12} />
        </Button>
      </div>

      <Textarea
        value={noteVal}
        onChange={(e) => setNoteVal(e.target.value)}
        onBlur={commitEdit}
        placeholder="Note..."
        className="w-full bg-white/[0.03] border border-white/[0.07] rounded px-2.5 py-2 text-[11px] text-white/60 resize-none focus-visible:ring-0 focus-visible:border-white/15 placeholder:text-white/15 min-h-[56px]"
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

      {save.trackSummary && save.trackSummary.length > 0 && (
        <div>
          <div className="text-[10px] text-white/20 uppercase tracking-wider mb-1">
            Tracks ({save.trackSummary.length})
          </div>
          <TrackThumbnail tracks={save.trackSummary} />
        </div>
      )}

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
                  <Badge
                    variant="secondary"
                    className="text-[9px] text-white/20 bg-white/[0.06] border-transparent px-1 py-px rounded uppercase h-auto"
                  >
                    {TTRACK[t.type] ?? t.type}
                  </Badge>
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
                  <Badge
                    variant="secondary"
                    className="text-[9px] text-white/15 bg-white/[0.04] border-transparent px-1 py-px rounded uppercase h-auto"
                  >
                    {TTRACK[t.type] ?? t.type}
                  </Badge>
                  <span className="truncate">{t.name}</span>
                </div>
              ))}
            </div>
          )}
          {sd.modifiedTracks.map((t) => (
            <div key={`mod-${t.type}-${t.name}`} className="pl-2 space-y-0.5">
              <div className="flex items-center gap-1.5 text-white/40">
                <Badge
                  variant="secondary"
                  className="text-[9px] text-white/20 bg-white/[0.06] border-transparent px-1 py-px rounded uppercase h-auto"
                >
                  {TTRACK[t.type] ?? t.type}
                </Badge>
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
                removedOther.length > 0 && `−${removedOther.length} files`,
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
          <ArrowCounterClockwise size={13} data-icon="inline-start" /> Full
          restore
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSmartRestore(true)}
        >
          <ArrowCounterClockwise size={13} data-icon="inline-start" /> Smart
          restore
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
          <Input
            value={ideaName}
            onChange={(e) => setIdeaName(e.target.value)}
            placeholder="New idea name..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateIdea();
            }}
            className="bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1.5 text-[11px] text-white/70 w-full focus-visible:ring-0 focus-visible:border-white/15 placeholder:text-white/15 h-auto"
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

      <SmartRestoreDialog
        open={showSmartRestore}
        projectId={projectId}
        saveId={save.id}
        onClose={() => setShowSmartRestore(false)}
        onSuccess={(result) => {
          toast.success(
            result.insertedReturnCount > 0
              ? `Restored ${result.restoredTrackNames.join(', ')} with ${result.insertedReturnCount} return${result.insertedReturnCount !== 1 ? 's' : ''}`
              : `Restored ${result.restoredTrackNames.join(', ')}`,
          );
        }}
      />
    </div>
  );
}
