import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FolderOpen,
  MusicNote,
  Export,
  CloudArrowUp,
} from '@phosphor-icons/react';
import type { Idea, PreviewRequestResult, Save } from '@/lib/types';
import { sendDaemonCommand } from '@/lib/daemon-client';

const ACCEPTED_EXTENSIONS = ['.wav', '.aif', '.aiff', '.mp3', '.m4a'];
const ACCEPT_STRING = ACCEPTED_EXTENSIONS.map((e) => `audio/*,${e}`).join(',');

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
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
  const [preview, setPreview] = useState<PreviewRequestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/projects/${projectId}/saves/${save.id}/preview/request`, {
      method: 'POST',
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed to request preview');
        if (!cancelled) setPreview(data.preview as PreviewRequestResult);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to request preview',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId, save.id]);

  const handleRevealFolder = async () => {
    setRevealing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/saves/${save.id}/preview/reveal-folder`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to reveal preview folder');
      }
      setPreview(data.preview as PreviewRequestResult);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to reveal preview folder';
      setError(message);
      toast.error(message);
    } finally {
      setRevealing(false);
    }
  };

  const uploadFile = useCallback(
    async (file: File) => {
      if (!isAcceptedFile(file)) {
        setError(`Unsupported format. Use ${ACCEPTED_EXTENSIONS.join(', ')}`);
        return;
      }
      setUploading(true);
      setError(null);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(
          `/api/projects/${projectId}/saves/${save.id}/preview/upload`,
          { method: 'POST', body: formData },
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? 'Upload failed');
        }
        toast.success('Preview attached');
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setError(message);
        toast.error(message);
      } finally {
        setUploading(false);
      }
    },
    [projectId, save.id, onClose],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void uploadFile(file);
    },
    [uploadFile],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void uploadFile(file);
      e.target.value = '';
    },
    [uploadFile],
  );

  const statusText =
    save.previewStatus === 'pending'
      ? 'Waiting for your export...'
      : save.previewStatus === 'ready'
        ? 'Preview ready'
        : save.previewStatus;

  const handleClose = useCallback(() => {
    // If the user closes the dialog while still pending (didn't upload),
    // cancel the pending state so the card stops showing "Waiting for export"
    if (save.previewStatus === 'pending') {
      void fetch(`/api/projects/${projectId}/saves/${save.id}/preview/cancel`, {
        method: 'POST',
      });
    }
    onClose();
  }, [projectId, save.id, save.previewStatus, onClose]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-[480px] p-0 gap-0 bg-[#111215] text-white border border-white/[0.08] rounded-xl overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="text-[15px] font-semibold text-white/90">
            Add a preview
          </DialogTitle>
          <DialogDescription className="text-[12px] text-white/40 mt-1 leading-relaxed">
            Drop an audio file here, or bounce from Ableton into the folder
            below.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pt-5 pb-6 space-y-5">
          {/* What save this is for */}
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-white/[0.05] border border-white/[0.06] flex items-center justify-center shrink-0">
              <MusicNote size={16} className="text-white/40" weight="duotone" />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] text-white/85 font-medium truncate">
                {save.label}
              </div>
              {idea && (
                <div className="text-[11px] text-white/35 truncate mt-0.5">
                  {idea.name}
                </div>
              )}
            </div>
          </div>

          {/* Drop zone */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_STRING}
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            disabled={uploading}
            className={`w-full rounded-lg border-2 border-dashed transition-colors p-6 flex flex-col items-center gap-2 cursor-pointer disabled:cursor-default disabled:opacity-60 ${
              dragOver
                ? 'border-white/30 bg-white/[0.06]'
                : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]'
            }`}
          >
            <CloudArrowUp
              size={24}
              className={`transition-colors ${dragOver ? 'text-white/60' : 'text-white/25'}`}
              weight="duotone"
            />
            <div className="text-[12px] text-white/50">
              {uploading
                ? 'Uploading...'
                : dragOver
                  ? 'Drop to attach'
                  : 'Drop audio file or click to browse'}
            </div>
            <div className="text-[10px] text-white/20">
              {ACCEPTED_EXTENSIONS.join(', ')}
            </div>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="text-[10px] text-white/20 uppercase tracking-wider">
              or export from Ableton
            </span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>

          {/* Export folder */}
          <button
            type="button"
            onClick={handleRevealFolder}
            disabled={loading || revealing}
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05] transition-colors p-4 text-left group cursor-pointer disabled:cursor-default disabled:opacity-60"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-white/35 mb-1.5">
                  Export to this folder
                </div>
                <div className="text-[11px] text-white/65 break-all leading-relaxed">
                  {loading ? 'Setting up...' : (preview?.folderPath ?? '...')}
                </div>
              </div>
              <div className="size-8 rounded-md bg-white/[0.04] group-hover:bg-white/[0.08] transition-colors flex items-center justify-center shrink-0">
                <FolderOpen
                  size={15}
                  className="text-white/35 group-hover:text-white/55 transition-colors"
                  weight="duotone"
                />
              </div>
            </div>
            <div className="text-[10px] text-white/25 mt-2">
              {revealing ? 'Opening in Finder...' : 'Click to open in Finder'}
              {' · any audio filename works'}
            </div>
          </button>

          {error && (
            <div className="rounded-lg bg-red-400/8 border border-red-400/12 px-3 py-2.5 text-[11px] text-red-300/75 leading-relaxed">
              {error}
            </div>
          )}

          {/* Footer area */}
          <div className="flex items-center justify-between pt-1">
            <div className="text-[11px] text-white/25">{statusText}</div>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-lg text-[11px] text-white/40 hover:text-white/70"
              onClick={() => {
                if (!idea) return;
                sendDaemonCommand({
                  type: 'open-idea',
                  projectId,
                  ideaId: idea.id,
                });
              }}
              disabled={!idea}
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
