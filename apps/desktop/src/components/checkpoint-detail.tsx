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
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
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
import { posthog } from "@/lib/posthog";
import { usePreviewStore } from "@/lib/preview-store";
import type { Idea, Project, Save, SaveAnalysis } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ArrangementMap, type SelectedClip } from "./arrangement-map";
import { ChangeList } from "./change-list";
import { describeSave } from "./checkpoint-row";
import { PianoRollDiff } from "./piano-roll-diff";
import { PreviewRequestDialog } from "./preview-request-dialog";
import {
  fileTabName,
  formatFullDateTime,
  formatTime,
  getKeepReasons,
  getSaveDisplayTitle,
} from "./timeline-utils";

async function fetchAnalysis(
  projectId: string,
  saveId: string
): Promise<SaveAnalysis> {
  const res = await fetch(
    `/api/projects/${projectId}/saves/${saveId}/analysis`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? "This checkpoint couldn't be analyzed.");
  }
  return data.analysis as SaveAnalysis;
}

/** Open the most interesting MIDI clip in the piano roll by default. */
function defaultClip(analysis: SaveAnalysis): SelectedClip | null {
  for (const status of ["edited", "added"] as const) {
    for (const track of analysis.tracks) {
      const clip = track.clips.find((c) => c.status === status && c.notes);
      if (clip) {
        return { clip, track };
      }
    }
  }
  return null;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 font-medium text-[12px] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SongChanges({ projectId, save }: { projectId: string; save: Save }) {
  const query = useQuery({
    queryFn: () => fetchAnalysis(projectId, save.id),
    queryKey: [
      "analysis",
      projectId,
      save.id,
      save.summary?.baseSaveId ?? null,
    ],
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [picked, setPicked] = useState<SelectedClip | null>(null);

  if (query.isPending) {
    return (
      <div className="space-y-2" role="status">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-raised" />
        <span className="sr-only">Reading the Ableton set…</span>
      </div>
    );
  }
  if (query.isError) {
    return (
      <p
        className="rounded-lg border border-line px-3 py-3 text-[12.5px] text-muted-foreground"
        role="alert"
      >
        {query.error.message}
      </p>
    );
  }

  const analysis = query.data;
  const selection = picked ?? defaultClip(analysis);
  return (
    <div className="space-y-6">
      <ArrangementMap
        analysis={analysis}
        onSelectClip={setPicked}
        selected={selection}
      />
      {selection && (
        <PianoRollDiff
          beatsPerBar={analysis.beatsPerBar}
          selection={selection}
        />
      )}
      <Section title="What changed">
        <ChangeList analysis={analysis} />
      </Section>
    </div>
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
    <div className="space-y-7 px-6 pt-5 pb-12">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[22px] text-foreground tabular-nums tracking-tight">
                {formatTime(save.createdAt)}
              </span>
              {isHead && (
                <span className="font-mono text-[10px] text-foreground uppercase tracking-wider">
                  Latest
                </span>
              )}
              {isBranchStart && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <GitBranch size={11} />
                  Branch start
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[12px] text-subtle-foreground">
              {formatFullDateTime(save.createdAt)}
              {idea ? ` · ${fileTabName(idea)}.als` : ""}
            </div>
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
          className="-ml-2 h-9 rounded-md border-transparent bg-transparent px-2 font-semibold text-[18px] tracking-tight shadow-none placeholder:font-normal placeholder:text-subtle-foreground hover:border-line focus-visible:border-input focus-visible:bg-raised focus-visible:ring-0 dark:bg-transparent"
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
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          {describeSave(project, save)}
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            onClick={() => {
              setBranch({ advanced: false, error: null, pending: false });
              setDialog("branch");
            }}
            type="button"
          >
            <GitBranch size={14} />
            Continue from here
          </Button>
          <Button
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
            <MusicNote size={14} />
            {save.previewStatus === "ready" ? "Listen" : "Attach audio"}
          </Button>
          {save.previewStatus === "ready" && (
            <Button
              className="text-muted-foreground"
              onClick={() => setDialog("preview")}
              size="sm"
              type="button"
              variant="ghost"
            >
              Replace audio
            </Button>
          )}
        </div>
        <p className="text-[11.5px] text-subtle-foreground">
          Continue from here opens this version in Ableton as a separate copy.
          Your current project is not changed.
        </p>
        {(save.previewStatus === "missing" ||
          save.previewStatus === "error") && (
          <p className="text-[12px] text-warning">
            {save.previewStatus === "missing"
              ? "The audio preview file is missing. Attach it again."
              : "The audio preview couldn't be imported. Attach it again."}
          </p>
        )}
      </header>

      <SongChanges projectId={projectId} save={save} />

      <Section title="Note">
        <Textarea
          className="min-h-[72px] resize-none rounded-lg border-line bg-raised text-[12.5px] leading-relaxed placeholder:text-subtle-foreground focus-visible:ring-0 dark:bg-raised"
          onBlur={commitEdit}
          onChange={(e) => setNoteVal(e.target.value)}
          placeholder="What were you trying here? What to fix next?"
          value={noteVal}
        />
        {(edit.pending || edit.saved || edit.error) && (
          <div
            className={cn(
              "mt-1.5 text-[11px]",
              edit.error ? "text-destructive" : "text-subtle-foreground"
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

      <footer className="space-y-3 border-line border-t pt-5">
        <div className="flex items-start gap-2 text-[12px]">
          <ShieldCheck
            className={cn(
              "mt-px shrink-0",
              keepReasons.length > 0 ? "text-success" : "text-subtle-foreground"
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
      </footer>

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
