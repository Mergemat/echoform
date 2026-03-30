import { GitFork, TrashSimple, X } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { basename } from "@/lib/path";
import { usePreviewStore } from "@/lib/preview-store";
import type { Idea, Project, Save } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PreviewRequestDialog } from "./preview-request-dialog";
import {
  formatDateTime,
  formatSize,
  getSaveDisplayTitle,
  isAls,
  isAudio,
} from "./timeline-utils";
import { TrackThumbnail } from "./track-thumbnail";

const TTRACK: Record<string, string> = {
  midi: "MIDI",
  audio: "Audio",
  return: "Return",
  group: "Group",
};

interface ExpandedCardProps {
  idea: Idea | undefined;
  isHead: boolean;
  onClose: () => void;
  project: Project;
  save: Save;
}

export function ExpandedCard(props: ExpandedCardProps) {
  return useExpandedCardView(props);
}

function useExpandedCardView({
  save,
  idea,
  isHead,
  project,
  onClose,
}: ExpandedCardProps) {
  const openPreviewPlayer = usePreviewStore((s) => s.openPreviewPlayer);
  const projectId = project.id;
  const [state, setState] = useState({
    computing: false,
    fileName: "",
    ideaName: "",
    labelVal: save.label,
    noteVal: save.note,
    showIdeaForm: false,
    showPreviewDialog: false,
  });
  const {
    computing,
    fileName,
    ideaName,
    labelVal,
    noteVal,
    showIdeaForm,
    showPreviewDialog,
  } = state;

  const commitEdit = () => {
    const nextLabel = labelVal.trim();
    const nextNote = noteVal;
    if (nextLabel === save.label && nextNote === save.note) {
      return;
    }
    sendDaemonCommand({
      type: "update-save",
      projectId,
      saveId: save.id,
      ...(nextNote === save.note ? {} : { note: nextNote }),
      ...(nextLabel === save.label ? {} : { label: nextLabel }),
    });
  };
  const handleDelete = () =>
    sendDaemonCommand({ type: "delete-save", projectId, saveId: save.id });
  const handleCreateIdea = () => {
    if (!ideaName.trim()) {
      return;
    }
    sendDaemonCommand({
      type: "branch-from-save",
      projectId,
      saveId: save.id,
      name: ideaName.trim(),
      fileName: fileName.trim() || `${ideaName.trim()}.als`,
    });
    setState((current) => ({
      ...current,
      fileName: "",
      ideaName: "",
      showIdeaForm: false,
    }));
  };
  const toggleBranchForm = () => {
    setState((current) => {
      const next = !current.showIdeaForm;
      if (next) {
        const defaultBranchName =
          current.ideaName.trim() || `Recovered ${getSaveDisplayTitle(save)}`;
        return {
          ...current,
          fileName: current.fileName.trim() || `${defaultBranchName}.als`,
          ideaName: defaultBranchName,
          showIdeaForm: true,
        };
      }
      return { ...current, showIdeaForm: false };
    });
  };
  const handleCompute = async () => {
    setState((current) => ({ ...current, computing: true }));
    void fetch(`/api/projects/${projectId}/saves/${save.id}/changes`, {
      method: "POST",
    }).finally(() => {
      setState((current) => ({ ...current, computing: false }));
    });
  };

  const changes = save.changes;
  const addedAudio =
    changes?.addedFiles.filter((f) => !isAls(f) && isAudio(f)) ?? [];
  const removedAudio =
    changes?.removedFiles.filter((f) => !isAls(f) && isAudio(f)) ?? [];
  const addedOther =
    changes?.addedFiles.filter((f) => !(isAls(f) || isAudio(f))) ?? [];
  const removedOther =
    changes?.removedFiles.filter((f) => !(isAls(f) || isAudio(f))) ?? [];
  const modifiedOther =
    changes?.modifiedFiles.filter((f) => !(isAls(f) || isAudio(f))) ?? [];
  const sd = save.setDiff;
  const needsAnalysis =
    changes === undefined || sd === undefined || !save.trackSummary;
  const summarizedTrackCount = save.trackSummary?.reduce(
    (sum, track) => sum + (track.trackCount ?? 1),
    0
  );
  const previewButtonLabel =
    save.previewStatus === "ready" ? "Preview" : "Add preview";
  const previewStatusText =
    save.previewStatus === "ready"
      ? "Audio preview attached"
      : save.previewStatus === "missing"
        ? "Preview file is missing"
        : save.previewStatus === "error"
          ? "Preview import needs attention"
          : null;

  return (
    <div className="space-y-2 border-white/50 border-l-2 bg-white/[0.04] pt-3 pr-5 pb-4 pl-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Input
            className="h-auto w-full rounded-none border-0 border-white/[0.08] border-b bg-transparent px-0 pb-1 font-medium text-sm text-white/90 focus-visible:border-white/25 focus-visible:ring-0"
            onBlur={commitEdit}
            onChange={(e) =>
              setState((current) => ({
                ...current,
                labelVal: e.target.value,
              }))
            }
            value={labelVal}
          />
          <div className="mt-1.5 flex items-center gap-1.5 text-white/25 text-xs">
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
                <span className="text-emerald-400/60">latest</span>
              </>
            )}
          </div>
        </div>
        <Button
          className="text-white/20 hover:text-white/50"
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X size={12} />
        </Button>
      </div>

      <Textarea
        className="min-h-[36px] w-full resize-none rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-white/55 text-xs placeholder:text-white/15 focus-visible:border-white/15 focus-visible:ring-0"
        onBlur={commitEdit}
        onChange={(e) =>
          setState((current) => ({
            ...current,
            noteVal: e.target.value,
          }))
        }
        placeholder="Add a note about this save..."
        value={noteVal}
      />

      <div className="flex items-center gap-1.5 text-[11px] text-white/30 tabular-nums">
        <span>{save.metadata.fileCount} files</span>
        <span className="text-white/10">·</span>
        <span>{save.metadata.audioFiles} audio</span>
        <span className="text-white/10">·</span>
        <span>{formatSize(save.metadata.sizeBytes)}</span>
      </div>

      {save.trackSummary && save.trackSummary.length > 0 && (
        <div>
          <div className="mb-1.5 font-medium text-[11px] text-white/20 uppercase tracking-wider">
            Tracks ({summarizedTrackCount ?? save.trackSummary.length})
          </div>
          <TrackThumbnail tracks={save.trackSummary} variant="detail" />
        </div>
      )}

      {sd && (
        <div className="space-y-1 text-xs">
          {sd.tempoChange && (
            <div className="flex items-center gap-1 text-[11px]">
              <span className="w-10 shrink-0 text-white/20 uppercase tracking-wider">
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
              <span className="w-10 shrink-0 text-white/20 uppercase tracking-wider">
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
                  className="flex items-center gap-1 text-[11px] text-emerald-400/50"
                  key={`add-${t.type}-${t.name}`}
                >
                  <span className="shrink-0">+</span>
                  <span className="shrink-0 text-[9px] text-white/15 uppercase tracking-wider">
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
                  className="flex items-center gap-1 text-[11px] text-red-400/50"
                  key={`rem-${t.type}-${t.name}`}
                >
                  <span className="shrink-0">−</span>
                  <span className="shrink-0 text-[9px] text-white/10 uppercase tracking-wider">
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
              className="space-y-px text-[11px]"
              key={`mod-${t.type}-${t.name}`}
            >
              <div className="flex items-center gap-1 text-white/40">
                <span className="shrink-0 text-[9px] text-white/15 uppercase tracking-wider">
                  {TTRACK[t.type] ?? t.type}
                </span>
                <span className="truncate">{t.name}</span>
                {t.renamedFrom && (
                  <span className="text-[10px] text-white/15">
                    ← {t.renamedFrom}
                  </span>
                )}
              </div>
              {(t.addedDevices.length > 0 ||
                t.removedDevices.length > 0 ||
                t.clipCountDelta !== 0 ||
                t.mixerChanges.length > 0) && (
                <div className="flex flex-wrap gap-x-2 pl-3 text-[10px] text-white/20">
                  {t.addedDevices.length > 0 && (
                    <span className="text-emerald-400/40">
                      +{t.addedDevices.join(", ")}
                    </span>
                  )}
                  {t.removedDevices.length > 0 && (
                    <span className="text-red-400/40">
                      −{t.removedDevices.join(", ")}
                    </span>
                  )}
                  {t.clipCountDelta !== 0 && (
                    <span
                      className={
                        t.clipCountDelta > 0
                          ? "text-emerald-400/40"
                          : "text-red-400/40"
                      }
                    >
                      {t.clipCountDelta > 0 ? "+" : ""}
                      {t.clipCountDelta} clips
                    </span>
                  )}
                  {t.mixerChanges.length > 0 && (
                    <span>{t.mixerChanges.join(", ")}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {needsAnalysis ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="mb-2 text-white/25 text-xs">
            {changes === undefined
              ? "No change data available"
              : "Detailed set analysis pending"}
          </div>
          <Button
            disabled={computing}
            onClick={handleCompute}
            size="sm"
            variant="outline"
          >
            {computing ? "Analyzing..." : "Analyze save"}
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
              <div className="mb-1 font-medium text-[11px] text-emerald-400/60 uppercase tracking-wider">
                New audio
              </div>
              {addedAudio.map((f) => (
                <div
                  className="truncate pl-2 font-mono text-white/45 text-xs"
                  key={f}
                >
                  {basename(f)}
                </div>
              ))}
            </div>
          )}
          {removedAudio.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-[11px] text-red-400/60 uppercase tracking-wider">
                Removed audio
              </div>
              {removedAudio.map((f) => (
                <div
                  className="truncate pl-2 font-mono text-white/30 text-xs line-through"
                  key={f}
                >
                  {basename(f)}
                </div>
              ))}
            </div>
          )}
          {addedOther.length + removedOther.length + modifiedOther.length >
            0 && (
            <div className="text-white/20 text-xs">
              {[
                addedOther.length > 0 && `+${addedOther.length} files`,
                removedOther.length > 0 && `−${removedOther.length} files`,
                modifiedOther.length > 0 && `~${modifiedOther.length} modified`,
              ]
                .filter(Boolean)
                .join(", ")}
            </div>
          )}
        </div>
      ) : null}

      {save.metadata.setFiles.length > 1 && (
        <div className="space-y-px text-[11px]">
          {save.metadata.setFiles.map((f) => (
            <div
              className={cn(
                "truncate rounded px-1.5 py-0.5 font-mono",
                f === save.metadata.activeSetPath
                  ? "bg-white/[0.04] text-white/50"
                  : "text-white/20"
              )}
              key={f}
            >
              {f}
              {f === save.metadata.activeSetPath && (
                <span className="ml-1 font-sans text-[10px] text-emerald-400/50 uppercase tracking-wider">
                  active
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <TooltipProvider>
        <div className="flex items-center gap-1 pt-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => {
                  if (save.previewStatus === "ready") {
                    openPreviewPlayer(save.id, project);
                    return;
                  }
                  setState((current) => ({
                    ...current,
                    showPreviewDialog: true,
                  }));
                }}
                size="sm"
                variant="outline"
              >
                {previewButtonLabel}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {save.previewStatus === "ready"
                ? "Listen to how your track sounded at this point"
                : "Attach an audio bounce to this save for playback"}
            </TooltipContent>
          </Tooltip>
          {save.previewStatus === "ready" && (
            <Button
              onClick={() =>
                setState((current) => ({ ...current, showPreviewDialog: true }))
              }
              size="sm"
              variant="ghost"
            >
              Replace
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={toggleBranchForm} size="sm" variant="ghost">
                <GitFork data-icon="inline-start" size={13} /> New version
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Create a new .als file from this point to try a different
              direction
            </TooltipContent>
          </Tooltip>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="text-white/15 hover:text-red-400/70"
                onClick={handleDelete}
                size="icon-sm"
                variant="ghost"
              >
                <TrashSimple size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Delete this save</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      {previewStatusText && (
        <div className="text-[11px] text-white/20">{previewStatusText}</div>
      )}

      {showIdeaForm && (
        <div className="space-y-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
          <div className="font-medium text-[11px] text-white/25 uppercase tracking-wider">
            New version
          </div>
          <div className="text-[11px] text-white/15 leading-snug">
            Creates a new .als file starting from this save, so you can explore
            a different direction without losing your current work.
          </div>
          <Input
            className="h-auto w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-2.5 py-2 text-white/70 text-xs placeholder:text-white/15 focus-visible:border-white/15 focus-visible:ring-0"
            onChange={(e) =>
              setState((current) => ({
                ...current,
                ideaName: e.target.value,
              }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCreateIdea();
              }
            }}
            placeholder="Version name..."
            value={ideaName}
          />
          <Input
            className="h-auto w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-2.5 py-2 text-white/70 text-xs placeholder:text-white/15 focus-visible:border-white/15 focus-visible:ring-0"
            onChange={(e) =>
              setState((current) => ({
                ...current,
                fileName: e.target.value,
              }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCreateIdea();
              }
            }}
            placeholder="File name (.als)..."
            value={fileName}
          />
          <Button
            disabled={!(ideaName.trim() && fileName.trim())}
            onClick={handleCreateIdea}
            size="sm"
            variant="outline"
          >
            Create version
          </Button>
        </div>
      )}

      <PreviewRequestDialog
        idea={idea}
        onClose={() =>
          setState((current) => ({ ...current, showPreviewDialog: false }))
        }
        open={showPreviewDialog}
        projectId={projectId}
        save={save}
      />
    </div>
  );
}
