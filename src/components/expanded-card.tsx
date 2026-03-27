import { sendDaemonCommand } from '@/lib/daemon-client';
import { usePreviewStore } from '@/lib/preview-store';
import { cn } from '@/lib/utils';
import { basename } from '@/lib/path';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
    <div className="pb-4 pt-3 pr-5 pl-4 space-y-2 border-l-2 border-white/50 bg-white/[0.04]">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <Input
            value={labelVal}
            onChange={(e) => setLabelVal(e.target.value)}
            onBlur={commitEdit}
            className="bg-transparent border-0 border-b border-white/[0.08] focus-visible:border-white/25 focus-visible:ring-0 rounded-none text-sm text-white/90 font-medium w-full px-0 pb-1 h-auto"
          />
          <div className="text-xs text-white/25 mt-1.5 flex items-center gap-1.5">
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
        className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-white/55 resize-none focus-visible:ring-0 focus-visible:border-white/15 placeholder:text-white/15 min-h-[36px]"
      />

      <div className="text-[11px] text-white/30 tabular-nums flex items-center gap-1.5">
        <span>{save.metadata.fileCount} files</span>
        <span className="text-white/10">·</span>
        <span>{save.metadata.audioFiles} audio</span>
        <span className="text-white/10">·</span>
        <span>{formatSize(save.metadata.sizeBytes)}</span>
      </div>

      {save.trackSummary && save.trackSummary.length > 0 && (
        <div>
          <div className="text-[11px] text-white/20 uppercase tracking-wider font-medium mb-1.5">
            Tracks ({summarizedTrackCount ?? save.trackSummary.length})
          </div>
          <TrackThumbnail tracks={save.trackSummary} variant="detail" />
        </div>
      )}

      {sd && (
        <div className="space-y-1 text-xs">
          {sd.tempoChange && (
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-white/20 uppercase tracking-wider w-10 shrink-0">
                Tempo
              </span>
              <span className="font-mono text-white/35 tabular-nums">
                {sd.tempoChange.from}
              </span>
              <span className="text-white/12">→</span>
              <span className="font-mono text-white/55 tabular-nums">
                {sd.tempoChange.to}
              </span>
              <span className="text-white/15">bpm</span>
            </div>
          )}
          {sd.timeSignatureChange && (
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-white/20 uppercase tracking-wider w-10 shrink-0">
                Time
              </span>
              <span className="font-mono text-white/35 tabular-nums">
                {sd.timeSignatureChange.from}
              </span>
              <span className="text-white/12">→</span>
              <span className="font-mono text-white/55 tabular-nums">
                {sd.timeSignatureChange.to}
              </span>
            </div>
          )}
          {sd.addedTracks.length > 0 && (
            <div className="space-y-px">
              {sd.addedTracks.map((t) => (
                <div
                  key={`add-${t.type}-${t.name}`}
                  className="flex items-center gap-1 text-[11px] text-emerald-400/50"
                >
                  <span className="shrink-0">+</span>
                  <span className="text-white/15 uppercase text-[9px] tracking-wider shrink-0">
                    {TTRACK[t.type] ?? t.type}
                  </span>
                  <span className="truncate text-white/40">{t.name}</span>
                </div>
              ))}
            </div>
          )}
          {sd.removedTracks.length > 0 && (
            <div className="space-y-px">
              {sd.removedTracks.map((t) => (
                <div
                  key={`rem-${t.type}-${t.name}`}
                  className="flex items-center gap-1 text-[11px] text-red-400/50"
                >
                  <span className="shrink-0">−</span>
                  <span className="text-white/10 uppercase text-[9px] tracking-wider shrink-0">
                    {TTRACK[t.type] ?? t.type}
                  </span>
                  <span className="truncate text-white/25 line-through">
                    {t.name}
                  </span>
                </div>
              ))}
            </div>
          )}
          {sd.modifiedTracks.map((t) => (
            <div
              key={`mod-${t.type}-${t.name}`}
              className="text-[11px] space-y-px"
            >
              <div className="flex items-center gap-1 text-white/40">
                <span className="text-white/15 uppercase text-[9px] tracking-wider shrink-0">
                  {TTRACK[t.type] ?? t.type}
                </span>
                <span className="truncate">{t.name}</span>
                {t.renamedFrom && (
                  <span className="text-white/15 text-[10px]">
                    ← {t.renamedFrom}
                  </span>
                )}
              </div>
              {(t.addedDevices.length > 0 ||
                t.removedDevices.length > 0 ||
                t.clipCountDelta !== 0 ||
                t.mixerChanges.length > 0) && (
                <div className="pl-3 text-[10px] text-white/20 flex flex-wrap gap-x-2">
                  {t.addedDevices.length > 0 && (
                    <span className="text-emerald-400/40">
                      +{t.addedDevices.join(', ')}
                    </span>
                  )}
                  {t.removedDevices.length > 0 && (
                    <span className="text-red-400/40">
                      −{t.removedDevices.join(', ')}
                    </span>
                  )}
                  {t.clipCountDelta !== 0 && (
                    <span
                      className={
                        t.clipCountDelta > 0
                          ? 'text-emerald-400/40'
                          : 'text-red-400/40'
                      }
                    >
                      {t.clipCountDelta > 0 ? '+' : ''}
                      {t.clipCountDelta} clips
                    </span>
                  )}
                  {t.mixerChanges.length > 0 && (
                    <span>{t.mixerChanges.join(', ')}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {needsAnalysis ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-xs text-white/25 mb-2">
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
              <div className="text-[11px] text-emerald-400/60 uppercase tracking-wider font-medium mb-1">
                New audio
              </div>
              {addedAudio.map((f) => (
                <div
                  key={f}
                  className="text-xs font-mono text-white/45 pl-2 truncate"
                >
                  {basename(f)}
                </div>
              ))}
            </div>
          )}
          {removedAudio.length > 0 && (
            <div>
              <div className="text-[11px] text-red-400/60 uppercase tracking-wider font-medium mb-1">
                Removed audio
              </div>
              {removedAudio.map((f) => (
                <div
                  key={f}
                  className="text-xs font-mono text-white/30 pl-2 truncate line-through"
                >
                  {basename(f)}
                </div>
              ))}
            </div>
          )}
          {addedOther.length + removedOther.length + modifiedOther.length >
            0 && (
            <div className="text-xs text-white/20">
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

      {save.metadata.setFiles.length > 1 && (
        <div className="text-[11px] space-y-px">
          {save.metadata.setFiles.map((f) => (
            <div
              key={f}
              className={cn(
                'font-mono truncate px-1.5 py-0.5 rounded',
                f === save.metadata.activeSetPath
                  ? 'text-white/50 bg-white/[0.04]'
                  : 'text-white/20',
              )}
            >
              {f}
              {f === save.metadata.activeSetPath && (
                <span className="text-emerald-400/50 ml-1 font-sans text-[10px] uppercase tracking-wider">
                  active
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 pt-0.5">
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
            Replace
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
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleDelete}
          className="text-white/15 hover:text-red-400/70"
        >
          <TrashSimple size={13} />
        </Button>
      </div>

      {previewStatusText && (
        <div className="text-[11px] text-white/20">{previewStatusText}</div>
      )}

      {showIdeaForm && (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 space-y-2.5">
          <div className="text-[11px] text-white/25 uppercase tracking-wider font-medium">
            New branch
          </div>
          <Input
            value={ideaName}
            onChange={(e) => setIdeaName(e.target.value)}
            placeholder="Branch name..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateIdea();
            }}
            className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-2 text-xs text-white/70 w-full focus-visible:ring-0 focus-visible:border-white/15 placeholder:text-white/15 h-auto"
          />
          <Input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="Branch file name (.als)..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateIdea();
            }}
            className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-2 text-xs text-white/70 w-full focus-visible:ring-0 focus-visible:border-white/15 placeholder:text-white/15 h-auto"
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
