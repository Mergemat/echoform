import {
  CaretDown,
  CircleNotch,
  GitBranch,
  MusicNote,
  PushPin,
  ShieldCheck,
  TrashSimple,
  X,
} from "@phosphor-icons/react";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { basename } from "@/lib/path";
import { posthog } from "@/lib/posthog";
import { usePreviewStore } from "@/lib/preview-store";
import type { Idea, Project, Save, SetDiff, TrackDiff } from "@/lib/types";
import { cn } from "@/lib/utils";
import { describeUnchangedSave } from "./checkpoint-row";
import { PreviewRequestDialog } from "./preview-request-dialog";
import {
  fileTabName,
  formatFullDateTime,
  formatSize,
  getKeepReasons,
  getSaveDisplayTitle,
  isAls,
  isAudio,
} from "./timeline-utils";
import { TrackList } from "./track-list";

const TRACK_TYPE: Record<string, string> = {
  audio: "Audio",
  group: "Group",
  midi: "MIDI",
  return: "Return",
};

/** Fingerprint a track's changes so identical edits can be grouped. */
function trackChangeKey(t: TrackDiff): string {
  return [
    t.addedDevices.slice().sort().join(","),
    t.removedDevices.slice().sort().join(","),
    t.deviceToggles
      .map((d) => `${d.name}:${d.enabled}`)
      .sort()
      .join(","),
    String(t.clipCountDelta),
    t.mixerChanges.slice().sort().join(","),
    String(t.colorChanged),
    t.renamedFrom ?? "",
  ].join("|");
}

function groupModifiedTracks(tracks: TrackDiff[]): TrackDiff[][] {
  const groups = new Map<string, TrackDiff[]>();
  for (const t of tracks) {
    const key = trackChangeKey(t);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()];
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-[12px] text-muted-foreground">
          {title}
        </h3>
        {aside && (
          <span className="text-[11px] text-subtle-foreground">{aside}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function ValueChange({
  label,
  from,
  to,
}: {
  label: string;
  from: ReactNode;
  to: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="text-subtle-foreground tabular-nums">{from}</span>
      <span className="text-subtle-foreground">→</span>
      <span className="font-medium tabular-nums">{to}</span>
    </div>
  );
}

function TrackChanges({ tracks }: { tracks: TrackDiff[] }) {
  return (
    <>
      {groupModifiedTracks(tracks).map((group) => {
        const rep = group[0]!;
        const details: { text: string; className?: string }[] = [];
        if (rep.renamedFrom && group.length === 1) {
          details.push({ text: `renamed from “${rep.renamedFrom}”` });
        }
        if (rep.addedDevices.length > 0) {
          details.push({
            className: "text-success",
            text: `added ${rep.addedDevices.join(", ")}`,
          });
        }
        if (rep.removedDevices.length > 0) {
          details.push({
            className: "text-destructive",
            text: `removed ${rep.removedDevices.join(", ")}`,
          });
        }
        for (const toggle of rep.deviceToggles) {
          details.push({
            text: `${toggle.name} turned ${toggle.enabled ? "on" : "off"}`,
          });
        }
        if (rep.clipCountDelta !== 0) {
          const n = Math.abs(rep.clipCountDelta);
          details.push({
            className:
              rep.clipCountDelta > 0 ? "text-success" : "text-destructive",
            text: `${rep.clipCountDelta > 0 ? "+" : "−"}${n} clip${n === 1 ? "" : "s"}`,
          });
        }
        if (rep.mixerChanges.length > 0) {
          details.push({ text: rep.mixerChanges.join(", ") });
        }
        if (rep.colorChanged) {
          details.push({ text: "color changed" });
        }

        return (
          <div className="text-[12px]" key={trackChangeKey(rep)}>
            <div className="flex items-baseline gap-2">
              <span className="font-medium">
                {group.map((t) => t.name).join(", ")}
              </span>
              {group.length === 1 && (
                <span className="text-[11px] text-subtle-foreground">
                  {TRACK_TYPE[rep.type] ?? rep.type}
                </span>
              )}
            </div>
            {details.length > 0 && (
              <div className="mt-0.5 text-muted-foreground">
                {details.map((d, i) => (
                  <span className={d.className} key={d.text}>
                    {i > 0 && (
                      <span className="text-subtle-foreground"> · </span>
                    )}
                    {d.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function SetChanges({ sd }: { sd: SetDiff }) {
  const hasValueChanges =
    sd.tempoChange ||
    sd.timeSignatureChange ||
    sd.arrangementLengthChange ||
    sd.sceneCountChange ||
    sd.locatorCountChange;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      {hasValueChanges && (
        <div className="space-y-1">
          {sd.tempoChange && (
            <ValueChange
              from={sd.tempoChange.from}
              label="Tempo"
              to={`${sd.tempoChange.to} BPM`}
            />
          )}
          {sd.timeSignatureChange && (
            <ValueChange
              from={sd.timeSignatureChange.from}
              label="Time sig."
              to={sd.timeSignatureChange.to}
            />
          )}
          {sd.arrangementLengthChange && (
            <ValueChange
              from={`${Math.round(sd.arrangementLengthChange.from / 4)} bars`}
              label="Length"
              to={`${Math.round(sd.arrangementLengthChange.to / 4)} bars`}
            />
          )}
          {sd.sceneCountChange && (
            <ValueChange
              from={sd.sceneCountChange.from}
              label="Scenes"
              to={sd.sceneCountChange.to}
            />
          )}
          {sd.locatorCountChange && (
            <ValueChange
              from={sd.locatorCountChange.from}
              label="Locators"
              to={sd.locatorCountChange.to}
            />
          )}
        </div>
      )}
      {sd.addedTracks.length > 0 && (
        <div className="space-y-0.5 text-[12px]">
          {sd.addedTracks.map((t) => (
            <div className="text-success" key={`add-${t.type}-${t.name}`}>
              + {t.name}{" "}
              <span className="text-[11px] text-subtle-foreground">
                {TRACK_TYPE[t.type] ?? t.type} track added
              </span>
            </div>
          ))}
        </div>
      )}
      {sd.removedTracks.length > 0 && (
        <div className="space-y-0.5 text-[12px]">
          {sd.removedTracks.map((t) => (
            <div className="text-destructive" key={`rem-${t.type}-${t.name}`}>
              − <span className="line-through">{t.name}</span>{" "}
              <span className="text-[11px] text-subtle-foreground">
                {TRACK_TYPE[t.type] ?? t.type} track removed
              </span>
            </div>
          ))}
        </div>
      )}
      {sd.modifiedTracks.length > 0 && (
        <div className="space-y-2">
          <TrackChanges tracks={sd.modifiedTracks} />
        </div>
      )}
      {sd.tracksReordered && (
        <div className="text-[12px] text-muted-foreground">
          Tracks were reordered
        </div>
      )}
    </div>
  );
}

function FileChanges({ save }: { save: Save }) {
  const changes = save.changes;
  if (!changes) {
    return null;
  }
  const notSet = (f: string) => !isAls(f);
  const addedAudio = changes.addedFiles.filter((f) => notSet(f) && isAudio(f));
  const removedAudio = changes.removedFiles.filter(
    (f) => notSet(f) && isAudio(f)
  );
  const otherCount = [
    ...changes.addedFiles,
    ...changes.removedFiles,
    ...changes.modifiedFiles,
  ].filter((f) => notSet(f) && !isAudio(f)).length;

  if (addedAudio.length + removedAudio.length + otherCount === 0) {
    return null;
  }

  return (
    <Section title="Files">
      <div className="space-y-0.5 rounded-lg border border-border bg-card p-3 text-[12px]">
        {addedAudio.map((f) => (
          <div className="truncate text-success" key={`a-${f}`} title={f}>
            + {basename(f)}
          </div>
        ))}
        {removedAudio.map((f) => (
          <div className="truncate text-destructive" key={`r-${f}`} title={f}>
            − <span className="line-through">{basename(f)}</span>
          </div>
        ))}
        {otherCount > 0 && (
          <div className="text-muted-foreground">
            {otherCount} other file{otherCount === 1 ? "" : "s"} changed
          </div>
        )}
      </div>
    </Section>
  );
}

interface CheckpointDetailProps {
  idea: Idea | undefined;
  isHead: boolean;
  onClose: () => void;
  project: Project;
  save: Save;
}

export function CheckpointDetail({
  save,
  idea,
  isHead,
  project,
  onClose,
}: CheckpointDetailProps) {
  const openPreviewPlayer = usePreviewStore((s) => s.openPreviewPlayer);
  const projectId = project.id;
  const editRequestGenerationRef = useRef(0);
  const savedLabel = save.customLabel ? save.label : "";
  const [labelVal, setLabelVal] = useState(savedLabel);
  const [noteVal, setNoteVal] = useState(save.note);
  const [edit, setEdit] = useState<{
    error: string | null;
    pending: boolean;
    saved: boolean;
  }>({ error: null, pending: false, saved: false });
  const [pin, setPin] = useState<{ error: string | null; pending: boolean }>({
    error: null,
    pending: false,
  });
  const [analysis, setAnalysis] = useState<{
    error: string | null;
    pending: boolean;
  }>({ error: null, pending: false });
  const [dialog, setDialog] = useState<
    "none" | "branch" | "delete" | "preview"
  >("none");
  const [branch, setBranch] = useState<{
    advanced: boolean;
    error: string | null;
    pending: boolean;
  }>({ advanced: false, error: null, pending: false });
  const [remove, setRemove] = useState<{
    error: string | null;
    pending: boolean;
  }>({ error: null, pending: false });

  const keepReasons = getKeepReasons(project, save);
  const isBranchStart = !save.auto && Boolean(project.continuedFrom);
  const sd = save.setDiff;
  const needsAnalysis =
    save.changes === undefined || sd === undefined || !save.trackSummary;
  const trackCount = save.trackSummary?.reduce(
    (sum, track) => sum + track.trackCount,
    0
  );

  const commitEdit = async () => {
    const nextLabel = labelVal.trim();
    if (nextLabel === savedLabel && noteVal === save.note) {
      return;
    }
    const generation = editRequestGenerationRef.current + 1;
    editRequestGenerationRef.current = generation;
    setEdit({ error: null, pending: true, saved: false });
    try {
      await sendDaemonCommand(
        {
          projectId,
          saveId: save.id,
          type: "update-save",
          ...(noteVal === save.note ? {} : { note: noteVal }),
          ...(nextLabel === savedLabel ? {} : { label: nextLabel }),
        },
        { reportError: false }
      );
      if (editRequestGenerationRef.current === generation) {
        setEdit({ error: null, pending: false, saved: true });
      }
    } catch (error) {
      if (editRequestGenerationRef.current === generation) {
        setEdit({
          error:
            error instanceof Error
              ? error.message
              : "Checkpoint details were not saved.",
          pending: false,
          saved: false,
        });
      }
    }
  };

  const handlePin = async () => {
    setPin({ error: null, pending: true });
    try {
      await sendDaemonCommand(
        {
          pinned: !save.pinned,
          projectId,
          saveId: save.id,
          type: "update-save",
        },
        { reportError: false }
      );
      setPin({ error: null, pending: false });
    } catch (error) {
      setPin({
        error:
          error instanceof Error
            ? error.message
            : "The checkpoint pin was not changed.",
        pending: false,
      });
    }
  };

  const handleAnalyze = async () => {
    posthog.capture("save_analysis_requested");
    setAnalysis({ error: null, pending: true });
    try {
      const res = await fetch(
        `/api/projects/${projectId}/saves/${save.id}/changes`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Analysis failed.");
      }
      setAnalysis({ error: null, pending: false });
    } catch (error) {
      setAnalysis({
        error: error instanceof Error ? error.message : "Analysis failed.",
        pending: false,
      });
    }
  };

  const handleBranch = async () => {
    setBranch((b) => ({ ...b, error: null, pending: true }));
    try {
      await sendDaemonCommand(
        {
          open: true,
          projectId,
          saveId: save.id,
          type: "recover-save",
        },
        { reportError: false }
      );
      posthog.capture("save_recovered");
      setBranch({ advanced: false, error: null, pending: false });
      setDialog("none");
    } catch (error) {
      setBranch((b) => ({
        ...b,
        error:
          error instanceof Error
            ? error.message
            : "The copy could not be created.",
        pending: false,
      }));
    }
  };

  const handleDelete = async () => {
    setRemove({ error: null, pending: true });
    try {
      await sendDaemonCommand(
        { projectId, saveId: save.id, type: "delete-save" },
        { reportError: false }
      );
      posthog.capture("save_deleted", { auto: save.auto });
      setRemove({ error: null, pending: false });
      setDialog("none");
    } catch (error) {
      setRemove({
        error:
          error instanceof Error
            ? error.message
            : "Checkpoint was not deleted.",
        pending: false,
      });
    }
  };

  return (
    <div className="space-y-6 px-6 pt-5 pb-10">
      <header>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {isHead && (
              <span className="rounded bg-success/10 px-1.5 py-px font-medium text-success">
                Latest
              </span>
            )}
            {isBranchStart && (
              <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-px text-muted-foreground">
                <GitBranch size={11} />
                Branch start
              </span>
            )}
            <span className="text-muted-foreground">
              {idea ? `${fileTabName(idea)}.als` : "Checkpoint"}
            </span>
          </div>
          <Button
            aria-label="Close"
            className="text-muted-foreground"
            onClick={onClose}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <X size={14} />
          </Button>
        </div>
        <Input
          aria-label="Checkpoint name"
          className="mt-2 -ml-2 h-9 rounded-md border-transparent bg-transparent px-2 font-semibold text-[17px] shadow-none placeholder:font-normal placeholder:text-subtle-foreground hover:border-border focus-visible:border-input focus-visible:bg-card focus-visible:ring-0 dark:bg-transparent"
          onBlur={commitEdit}
          onChange={(e) => setLabelVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          placeholder="Name this checkpoint…"
          value={labelVal}
        />
        <div className="mt-1 text-[12px] text-muted-foreground">
          Saved {formatFullDateTime(save.createdAt)}
        </div>
      </header>

      {/* Primary actions */}
      <div className="space-y-2">
        <Button
          className="w-full"
          onClick={() => {
            setBranch({ advanced: false, error: null, pending: false });
            setDialog("branch");
          }}
          type="button"
        >
          <GitBranch size={15} />
          Continue from here
        </Button>
        <p className="px-1 text-[11px] text-muted-foreground leading-relaxed">
          Opens this checkpoint in Ableton as a separate copy. Your current
          project is not changed.
        </p>
        <Button
          className="w-full"
          onClick={() => {
            if (save.previewStatus === "ready") {
              openPreviewPlayer(save.id, project);
            } else {
              setDialog("preview");
            }
          }}
          type="button"
          variant="outline"
        >
          <MusicNote size={15} />
          {save.previewStatus === "ready"
            ? "Listen to preview"
            : "Attach an audio preview"}
        </Button>
        {save.previewStatus === "ready" && (
          <button
            className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setDialog("preview")}
            type="button"
          >
            Replace preview
          </button>
        )}
        {(save.previewStatus === "missing" ||
          save.previewStatus === "error") && (
          <p className="px-1 text-[11px] text-warning">
            {save.previewStatus === "missing"
              ? "The preview file is missing. Attach it again."
              : "The preview couldn't be imported. Attach it again."}
          </p>
        )}
      </div>

      <Section title="What changed since the previous save">
        {sd ? (
          <SetChanges sd={sd} />
        ) : (
          <div className="rounded-lg border border-border bg-card p-3 text-[12px] text-muted-foreground">
            {describeUnchangedSave(project, save)}.
          </div>
        )}
        {needsAnalysis && (
          <div className="mt-2 flex items-center gap-3">
            <Button
              disabled={analysis.pending}
              onClick={() => void handleAnalyze()}
              size="xs"
              type="button"
              variant="outline"
            >
              {analysis.pending && (
                <CircleNotch className="animate-spin" size={12} />
              )}
              {analysis.pending ? "Analyzing…" : "Analyze changes"}
            </Button>
            {analysis.error && (
              <span className="text-[11px] text-destructive" role="alert">
                {analysis.error}
              </span>
            )}
          </div>
        )}
      </Section>

      <FileChanges save={save} />

      <Section title="Note">
        <Textarea
          className="min-h-[72px] resize-none rounded-lg border-border bg-card text-[12px] leading-relaxed placeholder:text-subtle-foreground focus-visible:ring-0 dark:bg-card"
          onBlur={commitEdit}
          onChange={(e) => setNoteVal(e.target.value)}
          placeholder="What were you trying here? What to fix next?"
          value={noteVal}
        />
        {(edit.pending || edit.saved || edit.error) && (
          <div
            className={cn(
              "mt-1.5 text-[11px]",
              edit.error ? "text-destructive" : "text-muted-foreground"
            )}
            role={edit.error ? "alert" : "status"}
          >
            {edit.error ??
              (edit.pending
                ? "Saving…"
                : "Checkpoint details saved to history.")}
          </div>
        )}
      </Section>

      {save.trackSummary && save.trackSummary.length > 0 && (
        <Section aside={`${trackCount} tracks`} title="Tracks in this version">
          <div className="rounded-lg border border-border bg-card p-1.5">
            <TrackList tracks={save.trackSummary} />
          </div>
        </Section>
      )}

      <Section title="Stored copy">
        <div className="space-y-1 text-[12px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Project size</span>
            <span className="tabular-nums">
              {formatSize(save.metadata.sizeBytes)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Files</span>
            <span className="tabular-nums">
              {save.metadata.fileCount} ({save.metadata.audioFiles} audio)
            </span>
          </div>
          {save.metadata.setFiles.length > 1 && (
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-muted-foreground">Sets</span>
              <span className="truncate text-right">
                {save.metadata.setFiles.map((f) => basename(f)).join(", ")}
              </span>
            </div>
          )}
        </div>
      </Section>

      <div className="space-y-3 border-border border-t pt-5">
        <div className="flex items-start gap-2 text-[12px]">
          <ShieldCheck
            className={cn(
              "mt-px shrink-0",
              keepReasons.length > 0 ? "text-success" : "text-muted-foreground"
            )}
            size={15}
          />
          <span className="text-muted-foreground leading-relaxed">
            {keepReasons.length > 0 ? (
              <>
                <span className="text-foreground">
                  Safe from automatic cleanup:
                </span>{" "}
                {keepReasons.join(", ")}.
              </>
            ) : (
              <>
                Once a project has a long history, older checkpoints are thinned
                out automatically. Pin, name, or add a note to keep this one.
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label={save.pinned ? "Unpin checkpoint" : "Pin checkpoint"}
            disabled={pin.pending}
            onClick={() => void handlePin()}
            size="sm"
            type="button"
            variant={save.pinned ? "secondary" : "outline"}
          >
            {pin.pending ? (
              <CircleNotch className="animate-spin" size={13} />
            ) : (
              <PushPin size={13} weight={save.pinned ? "fill" : "regular"} />
            )}
            {save.pinned ? "Pinned" : "Pin"}
          </Button>
          <div className="flex-1" />
          <Button
            aria-label="Delete checkpoint"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => {
              setRemove({ error: null, pending: false });
              setDialog("delete");
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <TrashSimple size={13} />
            Delete
          </Button>
        </div>
        {pin.error && (
          <div className="text-[11px] text-destructive" role="alert">
            {pin.error}
          </div>
        )}
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!(open || branch.pending)) {
            setDialog("none");
          }
        }}
        open={dialog === "branch"}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Continue from this checkpoint</DialogTitle>
            <DialogDescription className="leading-relaxed">
              Echoform rebuilds “{getSaveDisplayTitle(save)}” as a new, separate
              project and opens it in Ableton. Your current project stays
              exactly as it is.
            </DialogDescription>
          </DialogHeader>

          <div>
            <button
              aria-expanded={branch.advanced}
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
              onClick={() =>
                setBranch((b) => ({ ...b, advanced: !b.advanced }))
              }
              type="button"
            >
              <CaretDown
                className={cn(
                  "transition-transform duration-150",
                  !branch.advanced && "-rotate-90"
                )}
                size={11}
              />
              Advanced: recovery file and location
            </button>
            {branch.advanced && (
              <div className="mt-2 space-y-1.5 rounded-md bg-muted p-3 text-[12px] text-muted-foreground leading-relaxed">
                <p>
                  The copy is created in ~/Music/Echoform Recoveries with a
                  unique folder name and appears as its own project in the
                  sidebar.
                </p>
                <p>
                  Every file is verified against the checkpoint before Ableton
                  opens it. Existing files are never overwritten.
                </p>
              </div>
            )}
            {branch.error && (
              <div
                className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive"
                role="alert"
              >
                {branch.error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              disabled={branch.pending}
              onClick={() => setDialog("none")}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={branch.pending}
              onClick={() => void handleBranch()}
            >
              {branch.pending && (
                <CircleNotch className="animate-spin" size={13} />
              )}
              {branch.pending ? "Creating branch…" : "Create branch and open"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!(open || remove.pending)) {
            setDialog("none");
          }
        }}
        open={dialog === "delete"}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete checkpoint?</DialogTitle>
            <DialogDescription className="leading-relaxed">
              “{getSaveDisplayTitle(save)}” will be removed from history for
              good. Your Ableton project files are not touched.
            </DialogDescription>
          </DialogHeader>
          {remove.error && (
            <div
              className="rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive"
              role="alert"
            >
              {remove.error}
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={remove.pending}
              onClick={() => setDialog("none")}
              variant="ghost"
            >
              Keep checkpoint
            </Button>
            <Button
              disabled={remove.pending}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              {remove.pending && (
                <CircleNotch className="animate-spin" size={13} />
              )}
              {remove.pending ? "Deleting…" : "Delete checkpoint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PreviewRequestDialog
        idea={idea}
        onClose={() => setDialog("none")}
        open={dialog === "preview"}
        projectId={projectId}
        save={save}
      />
    </div>
  );
}
