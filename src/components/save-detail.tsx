import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { ArrowCounterClockwise, TrashSimple, PencilSimple, FloppyDisk, GitFork } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { ChangeSummary, SetDiff } from "@/lib/types";
import { basename, extname } from "@/lib/path";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatSizeDelta(bytes: number): string {
  const abs = Math.abs(bytes);
  const sign = bytes >= 0 ? "+" : "-";
  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(0)} KB`;
  return `${sign}${(abs / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const AUDIO_EXTENSIONS = new Set([".aif", ".aiff", ".flac", ".m4a", ".mp3", ".ogg", ".wav"]);

function isAbletonSet(path: string): boolean {
  return extname(path).toLowerCase() === ".als";
}

function isAudioFile(path: string): boolean {
  return AUDIO_EXTENSIONS.has(extname(path).toLowerCase());
}

/** Filter out .als files from a changes list - they're always going to change and aren't useful info */
function filterChanges(changes: ChangeSummary) {
  const filter = (files: string[]) => files.filter((f) => !isAbletonSet(f));
  const added = filter(changes.addedFiles);
  const removed = filter(changes.removedFiles);
  const modified = filter(changes.modifiedFiles);
  const addedAudio = added.filter(isAudioFile);
  const removedAudio = removed.filter(isAudioFile);
  const addedOther = added.filter((f) => !isAudioFile(f));
  const removedOther = removed.filter((f) => !isAudioFile(f));
  const modifiedOther = modified.filter((f) => !isAudioFile(f));
  const total = added.length + removed.length + modified.length;
  return { addedAudio, removedAudio, addedOther, removedOther, modifiedOther, total };
}

function ChangesSection({ changes, projectId, saveId }: {
  changes: ChangeSummary | undefined;
  projectId: string;
  saveId: string;
}) {
  const [computing, setComputing] = useState(false);

  const handleCompute = async () => {
    setComputing(true);
    try {
      await fetch(`/api/projects/${projectId}/saves/${saveId}/changes`, { method: "POST" });
    } finally {
      setComputing(false);
    }
  };

  if (!changes) {
    return (
      <div>
        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">Changes</div>
        <div className="text-[11px] text-white/20 mb-2">No change data for this save</div>
        <Button variant="ghost" size="sm" onClick={handleCompute} disabled={computing}>
          {computing ? "Computing..." : "Compute changes"}
        </Button>
      </div>
    );
  }

  const { sizeDelta } = changes;
  const { addedAudio, removedAudio, addedOther, removedOther, modifiedOther, total } = filterChanges(changes);

  if (total === 0 && sizeDelta === 0) {
    return (
      <div>
        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">Changes</div>
        <div className="text-[11px] text-white/20">Set file updated (no content changes)</div>
      </div>
    );
  }

  if (total === 0 && sizeDelta !== 0) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <div className="text-[10px] text-white/25 uppercase tracking-wider">Changes</div>
          <span className={cn(
            "text-[10px] font-mono tabular-nums",
            sizeDelta > 0 ? "text-emerald-400/50" : "text-red-400/50",
          )}>
            {formatSizeDelta(sizeDelta)}
          </span>
        </div>
        <div className="text-[11px] text-white/20">Set file updated</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] text-white/25 uppercase tracking-wider">Changes</div>
        {sizeDelta !== 0 && (
          <span className={cn(
            "text-[10px] font-mono tabular-nums",
            sizeDelta > 0 ? "text-emerald-400/50" : "text-red-400/50",
          )}>
            {formatSizeDelta(sizeDelta)}
          </span>
        )}
      </div>
      <div className="space-y-2 bg-white/[0.02] rounded-md border border-white/[0.04] p-2.5">
        {/* Audio added */}
        {addedAudio.length > 0 && (
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider font-medium text-emerald-400/60">
              New audio ({addedAudio.length})
            </div>
            {addedAudio.map((f) => (
              <div key={f} className="text-[11px] font-mono text-white/40 pl-2 truncate">
                {basename(f)}
              </div>
            ))}
          </div>
        )}
        {/* Audio removed */}
        {removedAudio.length > 0 && (
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider font-medium text-red-400/60">
              Removed audio ({removedAudio.length})
            </div>
            {removedAudio.map((f) => (
              <div key={f} className="text-[11px] font-mono text-white/30 pl-2 truncate">
                {basename(f)}
              </div>
            ))}
          </div>
        )}
        {/* Other file changes (presets, samples, etc) */}
        {(addedOther.length > 0 || removedOther.length > 0 || modifiedOther.length > 0) && (
          <div className="text-[11px] text-white/20">
            {[
              addedOther.length > 0 && `+${addedOther.length} files`,
              removedOther.length > 0 && `\u2212${removedOther.length} files`,
              modifiedOther.length > 0 && `~${modifiedOther.length} modified`,
            ].filter(Boolean).join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}

const TRACK_TYPE_LABELS: Record<string, string> = {
  midi: "MIDI",
  audio: "Audio",
  return: "Return",
  group: "Group",
};

function SetChangesSection({ setDiff }: { setDiff: SetDiff | undefined }) {
  if (!setDiff) return null;

  const { tempoChange, timeSignatureChange, addedTracks, removedTracks, modifiedTracks } = setDiff;

  return (
    <div>
      <div className="text-[10px] text-white/25 uppercase tracking-wider mb-2">Set changes</div>
      <div className="space-y-2 bg-white/[0.02] rounded-md border border-white/[0.04] p-2.5">
        {/* Tempo change */}
        {tempoChange && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-white/25">Tempo</span>
            <span className="font-mono text-white/40">{tempoChange.from}</span>
            <span className="text-white/15">&rarr;</span>
            <span className="font-mono text-white/60">{tempoChange.to}</span>
            <span className="text-white/25">bpm</span>
          </div>
        )}

        {/* Time signature change */}
        {timeSignatureChange && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-white/25">Time sig</span>
            <span className="font-mono text-white/40">{timeSignatureChange.from}</span>
            <span className="text-white/15">&rarr;</span>
            <span className="font-mono text-white/60">{timeSignatureChange.to}</span>
          </div>
        )}

        {/* Added tracks */}
        {addedTracks.length > 0 && (
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider font-medium text-emerald-400/60">
              New tracks ({addedTracks.length})
            </div>
            {addedTracks.map((t) => (
              <div key={`${t.type}-${t.name}`} className="text-[11px] text-white/40 pl-2 flex items-center gap-1.5">
                <span className="text-[9px] text-white/20 bg-white/[0.06] px-1 py-px rounded uppercase">
                  {TRACK_TYPE_LABELS[t.type] ?? t.type}
                </span>
                <span className="truncate">{t.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Removed tracks */}
        {removedTracks.length > 0 && (
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider font-medium text-red-400/60">
              Removed tracks ({removedTracks.length})
            </div>
            {removedTracks.map((t) => (
              <div key={`${t.type}-${t.name}`} className="text-[11px] text-white/30 pl-2 flex items-center gap-1.5">
                <span className="text-[9px] text-white/15 bg-white/[0.04] px-1 py-px rounded uppercase">
                  {TRACK_TYPE_LABELS[t.type] ?? t.type}
                </span>
                <span className="truncate">{t.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Modified tracks */}
        {modifiedTracks.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider font-medium text-amber-400/60">
              Modified tracks ({modifiedTracks.length})
            </div>
            {modifiedTracks.map((t) => (
              <div key={`${t.type}-${t.name}`} className="pl-2 space-y-0.5">
                <div className="text-[11px] text-white/40 flex items-center gap-1.5">
                  <span className="text-[9px] text-white/20 bg-white/[0.06] px-1 py-px rounded uppercase">
                    {TRACK_TYPE_LABELS[t.type] ?? t.type}
                  </span>
                  <span className="truncate">{t.name}</span>
                  {t.renamedFrom && (
                    <span className="text-white/20 text-[10px]">(was "{t.renamedFrom}")</span>
                  )}
                </div>
                <div className="pl-2 space-y-px text-[10px] text-white/25">
                  {t.addedDevices.length > 0 && (
                    <div className="text-emerald-400/50">+ {t.addedDevices.join(", ")}</div>
                  )}
                  {t.removedDevices.length > 0 && (
                    <div className="text-red-400/50">&minus; {t.removedDevices.join(", ")}</div>
                  )}
                  {t.clipCountDelta !== 0 && (
                    <div className={t.clipCountDelta > 0 ? "text-emerald-400/50" : "text-red-400/50"}>
                      {t.clipCountDelta > 0 ? "+" : ""}{t.clipCountDelta} clip{Math.abs(t.clipCountDelta) !== 1 ? "s" : ""}
                      {t.addedClips.length > 0 && ` (${t.addedClips.join(", ")})`}
                      {t.removedClips.length > 0 && ` (removed: ${t.removedClips.join(", ")})`}
                    </div>
                  )}
                  {t.mixerChanges.length > 0 && (
                    <div className="text-white/20">{t.mixerChanges.join(", ")}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SaveDetail() {
  const project = useStore((s) => s.selectedProject());
  const save = useStore((s) => s.selectedSave());
  const send = useStore((s) => s.send);
  const [editing, setEditing] = useState(false);
  const [noteVal, setNoteVal] = useState("");
  const [labelVal, setLabelVal] = useState("");
  const [showIdeaForm, setShowIdeaForm] = useState(false);
  const [ideaName, setIdeaName] = useState("");

  if (!project || !save) {
    return (
      <div className="h-full flex items-center justify-center text-white/15 text-[12px]">
        Click a save on the timeline to see details
      </div>
    );
  }

  const idea = project.ideas.find((i) => i.id === save.ideaId);
  const isHead = idea?.headSaveId === save.id;

  const startEdit = () => {
    setLabelVal(save.label);
    setNoteVal(save.note);
    setEditing(true);
  };

  const commitEdit = () => {
    send({ type: "update-save", projectId: project.id, saveId: save.id, note: noteVal, label: labelVal });
    setEditing(false);
  };

  const handleGoBack = () => {
    send({ type: "go-back-to", projectId: project.id, saveId: save.id });
  };

  const handleDelete = () => {
    send({ type: "delete-save", projectId: project.id, saveId: save.id });
  };

  const handleCreateIdea = () => {
    if (!ideaName.trim()) return;
    send({ type: "create-idea", projectId: project.id, fromSaveId: save.id, name: ideaName.trim() });
    setIdeaName("");
    setShowIdeaForm(false);
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div>
        {editing ? (
          <input
            value={labelVal}
            onChange={(e) => setLabelVal(e.target.value)}
            className="bg-white/[0.06] border border-white/10 rounded-md px-2 py-1 text-[14px] text-white font-medium w-full outline-none focus:border-white/20"
          />
        ) : (
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-medium text-white/90">{save.label}</h2>
            {save.auto && (
              <span className="text-[9px] uppercase tracking-wider text-white/20 bg-white/[0.05] px-1.5 py-0.5 rounded">
                auto
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1 text-[11px] text-white/30">
          <span>{formatDateTime(save.createdAt)}</span>
          <span className="text-white/10">|</span>
          <span>{idea?.name}</span>
          {isHead && (
            <>
              <span className="text-white/10">|</span>
              <span className="text-emerald-400/60">head</span>
            </>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Files", value: save.metadata.fileCount },
          { label: "Audio", value: save.metadata.audioFiles },
          { label: "Size", value: formatSize(save.metadata.sizeBytes) },
        ].map((item) => (
          <div key={item.label} className="bg-white/[0.03] rounded-md px-2.5 py-2 border border-white/[0.04]">
            <div className="text-[10px] text-white/25 uppercase tracking-wider">{item.label}</div>
            <div className="text-[13px] text-white/70 font-medium mt-0.5">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Note */}
      <div>
        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">Note</div>
        {editing ? (
          <textarea
            value={noteVal}
            onChange={(e) => setNoteVal(e.target.value)}
            placeholder="What changed? Why this idea?"
            className="bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-[12px] text-white/70 w-full min-h-[80px] resize-y outline-none focus:border-white/15 placeholder:text-white/15"
          />
        ) : (
          <p className="text-[12px] text-white/40 leading-relaxed">
            {save.note || "No note yet. Click edit to add one."}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {editing ? (
          <Button variant="outline" size="sm" onClick={commitEdit}>
            <FloppyDisk size={14} data-icon="inline-start" /> Save
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={startEdit}>
            <PencilSimple size={14} data-icon="inline-start" /> Edit
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={handleGoBack}>
          <ArrowCounterClockwise size={14} data-icon="inline-start" /> Go back to this
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowIdeaForm(!showIdeaForm)}>
          <GitFork size={14} data-icon="inline-start" /> Branch idea
        </Button>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          <TrashSimple size={14} data-icon="inline-start" /> Delete
        </Button>
      </div>

      {/* Create idea form */}
      {showIdeaForm && (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-md p-3 space-y-2">
          <div className="text-[11px] text-white/30 font-medium">Fork a new idea from this save</div>
          <input
            value={ideaName}
            onChange={(e) => setIdeaName(e.target.value)}
            placeholder="e.g. half-time bridge"
            className="bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-[12px] text-white/70 w-full outline-none focus:border-white/15 placeholder:text-white/15"
            onKeyDown={(e) => { if (e.key === "Enter") handleCreateIdea(); }}
          />
          <Button variant="outline" size="sm" onClick={handleCreateIdea} disabled={!ideaName.trim()}>
            Create idea
          </Button>
        </div>
      )}

      {/* Changes */}
      <ChangesSection changes={save.changes} projectId={project.id} saveId={save.id} />

      {/* Set changes (semantic .als diff) */}
      <SetChangesSection setDiff={save.setDiff} />

      {/* Set files */}
      <div>
        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">Set files</div>
        <div className="space-y-0.5">
          {save.metadata.setFiles.map((f) => (
            <div key={f} className={cn(
              "text-[11px] font-mono px-2 py-1 rounded",
              f === save.metadata.activeSetPath ? "text-white/50 bg-white/[0.04]" : "text-white/25",
            )}>
              {f} {f === save.metadata.activeSetPath && <span className="text-emerald-400/50 ml-1">active</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
