import { sendDaemonCommand } from '@/lib/daemon-client';
import { usePreviewStore } from '@/lib/preview-store';
import { cn } from '@/lib/utils';
import { basename } from '@/lib/path';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import type { Save, Idea } from '@/lib/types';
import { useState } from 'react';
import { TrashSimple, GitFork, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { formatDateTime, formatSize, isAudio, isAls } from './timeline-utils';
import { TrackThumbnail } from './track-thumbnail';
import { SmartRestoreDialog } from './smart-restore-dialog';
import { PreviewRequestDialog } from './preview-request-dialog';

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
  onClose,
}: {
  save: Save;
  idea: Idea | undefined;
  isHead: boolean;
  projectId: string;
  onClose: () => void;
}) {
  const openPreviewPlayer = usePreviewStore((s) => s.openPreviewPlayer);
  const [labelVal, setLabelVal] = useState(save.label);
  const [noteVal, setNoteVal] = useState(save.note);
  const [showIdeaForm, setShowIdeaForm] = useState(false);
  const [showSmartRestore, setShowSmartRestore] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [ideaName, setIdeaName] = useState('');
  const [fileName, setFileName] = useState('');
  const [computing, setComputing] = useState(false);

  const commitEdit = () =>
    sendDaemonCommand({
      type: 'update-save',
      projectId,
      saveId: save.id,
      note: noteVal,
      label: labelVal,
    });
  const handleDelete = () =>
    sendDaemonCommand({ type: 'delete-save', projectId, saveId: save.id });
  const handleCreateIdea = () => {
    if (!ideaName.trim()) return;
    sendDaemonCommand({
      type: 'branch-from-save',
      projectId,
      saveId: save.id,
      name: ideaName.trim(),
      fileName: fileName.trim() || `${ideaName.trim()}.als`,
    });
    setIdeaName('');
    setFileName('');
    setShowIdeaForm(false);
  };
  const toggleBranchForm = () => {
    setShowIdeaForm((prev) => {
      const next = !prev;
      if (next) {
        const defaultBranchName = ideaName.trim() || `Recovered ${save.label}`;
        setIdeaName(defaultBranchName);
        setFileName(fileName.trim() || `${defaultBranchName}.als`);
      }
      return next;
    });
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
  const needsAnalysis =
    changes === undefined || sd === undefined || !save.trackSummary;
  const summarizedTrackCount = save.trackSummary?.reduce(
    (sum, track) => sum + (track.trackCount ?? 1),
    0,
  );
  const previewButtonLabel =
    save.previewStatus === 'ready' ? 'Preview' : 'Add preview';
  const previewStatusText =
    save.previewStatus === 'ready'
      ? 'Audio preview attached'
      : save.previewStatus === 'missing'
        ? 'Preview file is missing'
        : save.previewStatus === 'error'
          ? 'Preview import needs attention'
          : null;

  return (
    <div className="pb-4 pt-2 pr-4 pl-3 space-y-3.5 border-l-2 border-white/50 bg-white/[0.04]">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <Input
            value={labelVal}
            onChange={(e) => setLabelVal(e.target.value)}
            onBlur={commitEdit}
            className="bg-transparent border-0 border-b border-white/[0.08] focus-visible:border-white/25 focus-visible:ring-0 rounded-none text-[13px] text-white/90 font-medium w-full px-0 pb-1 h-auto"
          />
          <div className="text-[11px] text-white/25 mt-1.5 flex items-center gap-1.5">
            <span>{formatDateTime(save.createdAt)}</span>
            {idea && (
              <>
                <span className="text-white/10">·</span>
                <span>{idea.name}</span>
              </>
            )}
            {isHead && (
              <>
                <span className="text-white/10">·</span>
                <span className="text-emerald-400/60">head</span>
              </>
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="text-white/20 hover:text-white/50"
        >
          <X size={12} />
        </Button>
      </div>

      <Textarea
        value={noteVal}
        onChange={(e) => setNoteVal(e.target.value)}
        onBlur={commitEdit}
        placeholder="Add a note about this save..."
        className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2.5 text-[11px] text-white/55 resize-none focus-visible:ring-0 focus-visible:border-white/15 placeholder:text-white/15 min-h-[56px]"
      />

      <div className="grid grid-cols-3 gap-1.5 text-[10px]">
        {[
          { label: 'Files', value: save.metadata.fileCount },
          { label: 'Audio', value: save.metadata.audioFiles },
          { label: 'Size', value: formatSize(save.metadata.sizeBytes) },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-white/[0.03] rounded-lg px-2.5 py-1.5 border border-white/[0.05]"
          >
            <div className="text-white/20 uppercase tracking-wider text-[9px]">
              {item.label}
            </div>
            <div className="text-white/65 font-medium mt-0.5 tabular-nums">
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {save.trackSummary && save.trackSummary.length > 0 && (
        <div>
          <div className="text-[10px] text-white/20 uppercase tracking-wider font-medium mb-1.5">
            Tracks ({summarizedTrackCount ?? save.trackSummary.length})
          </div>
          <TrackThumbnail tracks={save.trackSummary} variant="detail" />
        </div>
      )}

      {sd && (
        <div className="space-y-2 text-[11px]">
          {sd.tempoChange && (
            <div className="flex items-center gap-1.5">
              <span className="text-white/25 text-[10px] uppercase tracking-wider w-12 shrink-0">
                Tempo
              </span>
              <span className="font-mono text-white/40 tabular-nums">
                {sd.tempoChange.from}
              </span>
              <span className="text-white/15">→</span>
              <span className="font-mono text-white/65 tabular-nums">
                {sd.tempoChange.to}
              </span>
              <span className="text-white/20">bpm</span>
            </div>
          )}
          {sd.timeSignatureChange && (
            <div className="flex items-center gap-1.5">
              <span className="text-white/25 text-[10px] uppercase tracking-wider w-12 shrink-0">
                Time
              </span>
              <span className="font-mono text-white/40 tabular-nums">
                {sd.timeSignatureChange.from}
              </span>
              <span className="text-white/15">→</span>
              <span className="font-mono text-white/65 tabular-nums">
                {sd.timeSignatureChange.to}
              </span>
            </div>
          )}
          {sd.addedTracks.length > 0 && (
            <div>
              <div className="text-[10px] text-emerald-400/60 uppercase tracking-wider font-medium mb-1">
                New tracks
              </div>
              <div className="space-y-0.5">
                {sd.addedTracks.map((t) => (
                  <div
                    key={`add-${t.type}-${t.name}`}
                    className="pl-2 flex items-center gap-1.5 text-white/45"
                  >
                    <Badge
                      variant="secondary"
                      className="text-[9px] text-white/25 bg-white/[0.05] border-transparent px-1 py-px rounded uppercase h-auto"
                    >
                      {TTRACK[t.type] ?? t.type}
                    </Badge>
                    <span className="truncate">{t.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {sd.removedTracks.length > 0 && (
            <div>
              <div className="text-[10px] text-red-400/60 uppercase tracking-wider font-medium mb-1">
                Removed tracks
              </div>
              <div className="space-y-0.5">
                {sd.removedTracks.map((t) => (
                  <div
                    key={`rem-${t.type}-${t.name}`}
                    className="pl-2 flex items-center gap-1.5 text-white/30"
                  >
                    <Badge
                      variant="secondary"
                      className="text-[9px] text-white/15 bg-white/[0.03] border-transparent px-1 py-px rounded uppercase h-auto"
                    >
                      {TTRACK[t.type] ?? t.type}
                    </Badge>
                    <span className="truncate line-through">{t.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {sd.modifiedTracks.map((t) => (
            <div key={`mod-${t.type}-${t.name}`} className="pl-2 space-y-1">
              <div className="flex items-center gap-1.5 text-white/45">
                <Badge
                  variant="secondary"
                  className="text-[9px] text-white/25 bg-white/[0.05] border-transparent px-1 py-px rounded uppercase h-auto"
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

      {needsAnalysis ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[11px] text-white/25 mb-2">
            {changes === undefined
              ? 'No change data available'
              : 'Detailed set analysis pending'}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCompute}
            disabled={computing}
          >
            {computing ? 'Analyzing...' : 'Analyze save'}
          </Button>
        </div>
      ) : addedAudio.length +
          removedAudio.length +
          addedOther.length +
          removedOther.length +
          modifiedOther.length >
        0 ? (
        <div className="space-y-2 rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
          {addedAudio.length > 0 && (
            <div>
              <div className="text-[10px] text-emerald-400/60 uppercase tracking-wider font-medium mb-1">
                New audio
              </div>
              {addedAudio.map((f) => (
                <div
                  key={f}
                  className="text-[11px] font-mono text-white/45 pl-2 truncate"
                >
                  {basename(f)}
                </div>
              ))}
            </div>
          )}
          {removedAudio.length > 0 && (
            <div>
              <div className="text-[10px] text-red-400/60 uppercase tracking-wider font-medium mb-1">
                Removed audio
              </div>
              {removedAudio.map((f) => (
                <div
                  key={f}
                  className="text-[11px] font-mono text-white/30 pl-2 truncate line-through"
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
          <div className="text-[10px] text-white/20 uppercase tracking-wider font-medium mb-1.5">
            Set files
          </div>
          <div className="space-y-0.5">
            {save.metadata.setFiles.map((f) => (
              <div
                key={f}
                className={cn(
                  'text-[10px] font-mono px-2 py-1 rounded-md truncate',
                  f === save.metadata.activeSetPath
                    ? 'text-white/55 bg-white/[0.04]'
                    : 'text-white/20',
                )}
              >
                {f}
                {f === save.metadata.activeSetPath && (
                  <span className="text-emerald-400/50 ml-1.5 font-sans text-[9px] uppercase tracking-wider">
                    active
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (save.previewStatus === 'ready') {
              openPreviewPlayer(save.id);
              return;
            }
            setShowPreviewDialog(true);
          }}
        >
          {previewButtonLabel}
        </Button>
        {save.previewStatus === 'ready' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreviewDialog(true)}
          >
            Replace preview
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSmartRestore(true)}
        >
          Smart restore
        </Button>
        <Button variant="ghost" size="sm" onClick={toggleBranchForm}>
          <GitFork size={13} data-icon="inline-start" /> Branch
        </Button>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          <TrashSimple size={13} data-icon="inline-start" /> Delete
        </Button>
      </div>

      {previewStatusText && (
        <div className="text-[10px] text-white/20">{previewStatusText}</div>
      )}

      {showIdeaForm && (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 space-y-2.5">
          <div className="text-[10px] text-white/25 uppercase tracking-wider font-medium">
            New branch
          </div>
          <Input
            value={ideaName}
            onChange={(e) => setIdeaName(e.target.value)}
            placeholder="Branch name..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateIdea();
            }}
            className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-2 text-[11px] text-white/70 w-full focus-visible:ring-0 focus-visible:border-white/15 placeholder:text-white/15 h-auto"
          />
          <Input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="Branch file name (.als)..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateIdea();
            }}
            className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-2 text-[11px] text-white/70 w-full focus-visible:ring-0 focus-visible:border-white/15 placeholder:text-white/15 h-auto"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreateIdea}
            disabled={!ideaName.trim() || !fileName.trim()}
          >
            Create branch file
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
      <PreviewRequestDialog
        open={showPreviewDialog}
        projectId={projectId}
        save={save}
        idea={idea}
        onClose={() => setShowPreviewDialog(false)}
      />
    </div>
  );
}
