import {
  CloudArrowUp,
  Export,
  FolderOpen,
  MusicNote,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sendDaemonCommand } from "@/lib/daemon-client";
import type { Idea, PreviewRequestResult, Save } from "@/lib/types";
import { getSaveDisplayTitle } from "./timeline-utils";

const ACCEPTED_EXTENSIONS = [".wav", ".aif", ".aiff", ".mp3", ".m4a"];
const ACCEPT_STRING = ACCEPTED_EXTENSIONS.map((e) => `audio/*,${e}`).join(",");
const previewRequestQueryKey = (projectId: string, saveId: string) =>
  ["preview-request", projectId, saveId] as const;

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

async function requestPreview(
  projectId: string,
  saveId: string
): Promise<PreviewRequestResult> {
  const res = await fetch(
    `/api/projects/${projectId}/saves/${saveId}/preview/request`,
    {
      method: "POST",
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Failed to request preview");
  }
  return data.preview as PreviewRequestResult;
}

export function PreviewRequestDialog({
  open,
  projectId,
  save,
  idea,
  onClose,
}: {
  open: boolean;
  projectId: string;
  save: Save;
  idea: Idea | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [ui, setUi] = useState({
    actionError: null as string | null,
    dragOver: false,
    revealing: false,
    uploading: false,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryKey = previewRequestQueryKey(projectId, save.id);
  const previewQuery = useQuery({
    queryKey,
    queryFn: () => requestPreview(projectId, save.id),
    enabled: open,
    gcTime: 0,
    staleTime: 0,
  });
  const preview = previewQuery.data ?? null;
  const loading = previewQuery.isPending;
  const revealing = ui.revealing;
  const uploading = ui.uploading;
  const dragOver = ui.dragOver;
  const error =
    ui.actionError ??
    (previewQuery.error instanceof Error ? previewQuery.error.message : null);

  const handleRevealFolder = () => {
    setUi((current) => ({
      ...current,
      actionError: null,
      revealing: true,
    }));
    void fetch(
      `/api/projects/${projectId}/saves/${save.id}/preview/reveal-folder`,
      {
        method: "POST",
      }
    )
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "Failed to reveal preview folder");
        }
        queryClient.setQueryData(
          queryKey,
          data.preview as PreviewRequestResult
        );
      })
      .catch((err) => {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to reveal preview folder";
        setUi((current) => ({ ...current, actionError: message }));
        toast.error(message);
      })
      .finally(() => {
        setUi((current) => ({ ...current, revealing: false }));
      });
  };

  const uploadFile = useCallback(
    (file: File) => {
      if (!isAcceptedFile(file)) {
        setUi((current) => ({
          ...current,
          actionError: `Unsupported format. Use ${ACCEPTED_EXTENSIONS.join(", ")}`,
        }));
        return;
      }
      const formData = new FormData();
      formData.append("file", file);
      setUi((current) => ({
        ...current,
        actionError: null,
        uploading: true,
      }));
      void fetch(`/api/projects/${projectId}/saves/${save.id}/preview/upload`, {
        method: "POST",
        body: formData,
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error ?? "Upload failed");
          }
          toast.success("Preview attached");
          queryClient.invalidateQueries({ queryKey });
          onClose();
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : "Upload failed";
          setUi((current) => ({ ...current, actionError: message }));
          toast.error(message);
        })
        .finally(() => {
          setUi((current) => ({ ...current, uploading: false }));
        });
    },
    [onClose, projectId, queryClient, queryKey, save.id]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setUi((current) => ({ ...current, dragOver: false }));
      const file = e.dataTransfer.files[0];
      if (file) {
        void uploadFile(file);
      }
    },
    [uploadFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        void uploadFile(file);
      }
      e.target.value = "";
    },
    [uploadFile]
  );

  const statusText =
    save.previewStatus === "pending"
      ? "Waiting for your export..."
      : save.previewStatus === "ready"
        ? "Preview ready"
        : save.previewStatus;

  const handleClose = useCallback(() => {
    // If the user closes the dialog while still pending (didn't upload),
    // cancel the pending state so the card stops showing "Waiting for export"
    if (save.previewStatus === "pending") {
      void fetch(`/api/projects/${projectId}/saves/${save.id}/preview/cancel`, {
        method: "POST",
      });
    }
    onClose();
  }, [projectId, save.id, save.previewStatus, onClose]);

  const handleDialogOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      return;
    }
    setUi({
      actionError: null,
      dragOver: false,
      revealing: false,
      uploading: false,
    });
    handleClose();
  };

  return (
    <Dialog onOpenChange={handleDialogOpenChange} open={open}>
      <DialogContent className="gap-0 overflow-hidden rounded-xl border border-white/[0.08] bg-[#111215] p-0 text-white sm:max-w-[480px]">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="font-semibold text-base text-white/90">
            Add a preview
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-white/40 leading-relaxed">
            Drop an audio file here, or bounce from Ableton into the folder
            below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 pt-5 pb-6">
          {/* What save this is for */}
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.05]">
              <MusicNote className="text-white/40" size={16} weight="duotone" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium text-sm text-white/85">
                {getSaveDisplayTitle(save)}
              </div>
              {idea && (
                <div className="mt-0.5 truncate text-white/35 text-xs">
                  {idea.name}
                </div>
              )}
            </div>
          </div>

          {/* Drop zone */}
          <input
            accept={ACCEPT_STRING}
            className="hidden"
            onChange={handleFileChange}
            ref={fileInputRef}
            type="file"
          />
          <button
            className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors disabled:cursor-default disabled:opacity-60 ${
              dragOver
                ? "border-white/30 bg-white/[0.06]"
                : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]"
            }`}
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            onDragLeave={() =>
              setUi((current) => ({ ...current, dragOver: false }))
            }
            onDragOver={(e) => {
              e.preventDefault();
              setUi((current) => ({ ...current, dragOver: true }));
            }}
            onDrop={handleDrop}
            type="button"
          >
            <CloudArrowUp
              className={`transition-colors ${dragOver ? "text-white/60" : "text-white/25"}`}
              size={24}
              weight="duotone"
            />
            <div className="text-[13px] text-white/50">
              {uploading
                ? "Uploading..."
                : dragOver
                  ? "Drop to attach"
                  : "Drop audio file or click to browse"}
            </div>
            <div className="text-[11px] text-white/20">
              {ACCEPTED_EXTENSIONS.join(", ")}
            </div>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-[11px] text-white/20 uppercase tracking-wider">
              or export from Ableton
            </span>
            <div className="h-px flex-1 bg-white/[0.06]" />
          </div>

          {/* Export folder */}
          <button
            className="group w-full cursor-pointer rounded-lg border border-white/[0.06] bg-white/[0.03] p-4 text-left transition-colors hover:bg-white/[0.05] disabled:cursor-default disabled:opacity-60"
            disabled={loading || revealing}
            onClick={handleRevealFolder}
            type="button"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 text-white/35 text-xs">
                  Export to this folder
                </div>
                <div className="break-all text-white/65 text-xs leading-relaxed">
                  {loading ? "Setting up..." : (preview?.folderPath ?? "...")}
                </div>
              </div>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/[0.04] transition-colors group-hover:bg-white/[0.08]">
                <FolderOpen
                  className="text-white/35 transition-colors group-hover:text-white/55"
                  size={15}
                  weight="duotone"
                />
              </div>
            </div>
            <div className="mt-2 text-[11px] text-white/25">
              {revealing ? "Opening in Finder..." : "Click to open in Finder"}
              {" · any audio filename works"}
            </div>
          </button>

          {error && (
            <div className="rounded-lg border border-red-400/12 bg-red-400/8 px-3 py-2.5 text-red-300/75 text-xs leading-relaxed">
              {error}
            </div>
          )}

          {/* Footer area */}
          <div className="flex items-center justify-between pt-1">
            <div className="text-white/25 text-xs">{statusText}</div>
            <Button
              className="rounded-lg text-white/40 text-xs hover:text-white/70"
              disabled={!idea}
              onClick={() => {
                if (!idea) {
                  return;
                }
                sendDaemonCommand({
                  type: "open-idea",
                  projectId,
                  ideaId: idea.id,
                });
              }}
              size="sm"
              variant="ghost"
            >
              <Export size={14} />
              Open in Ableton
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
