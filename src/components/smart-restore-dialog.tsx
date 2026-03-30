import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { SmartRestoreResult, SmartRestoreTrack } from "@/lib/types";
import { cn } from "@/lib/utils";

function trackTypeLabel(type: SmartRestoreTrack["type"]): string {
  if (type === "midi") {
    return "MIDI";
  }
  if (type === "audio") {
    return "Audio";
  }
  return "Group";
}

async function requestSmartRestoreTracks(
  projectId: string,
  saveId: string
): Promise<SmartRestoreTrack[]> {
  const res = await fetch(
    `/api/projects/${projectId}/saves/${saveId}/smart-restore/tracks`
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Failed to load tracks");
  }
  return data.tracks as SmartRestoreTrack[];
}

export function SmartRestoreDialog({
  open,
  projectId,
  saveId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  projectId: string;
  saveId: string;
  onClose: () => void;
  onSuccess: (result: SmartRestoreResult) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ui, setUi] = useState({
    error: null as string | null,
    submitting: false,
  });
  const tracksQuery = useQuery({
    queryKey: ["smart-restore-tracks", projectId, saveId],
    queryFn: () => requestSmartRestoreTracks(projectId, saveId),
    enabled: open,
    gcTime: 0,
    staleTime: 0,
  });
  const tracks = tracksQuery.data ?? [];
  const loading = tracksQuery.isPending;
  const submitting = ui.submitting;
  const error =
    ui.error ??
    (tracksQuery.error instanceof Error ? tracksQuery.error.message : null);

  const selectedCount = selectedIds.length;
  const selectedLabel = useMemo(() => {
    if (selectedCount === 0) {
      return "Select tracks";
    }
    if (selectedCount === 1) {
      return "Restore 1 track";
    }
    return `Restore ${selectedCount} tracks`;
  }, [selectedCount]);

  const toggle = (trackId: string) => {
    setSelectedIds((current) =>
      current.includes(trackId)
        ? current.filter((id) => id !== trackId)
        : [...current, trackId]
    );
  };

  const handleSubmit = () => {
    if (selectedIds.length === 0) {
      return;
    }
    setUi({ error: null, submitting: true });
    void fetch(`/api/projects/${projectId}/saves/${saveId}/smart-restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackIds: selectedIds }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "Smart Restore failed");
        }
        onSuccess(data.result as SmartRestoreResult);
        onClose();
      })
      .catch((err) => {
        setUi({
          error: err instanceof Error ? err.message : "Smart Restore failed",
          submitting: false,
        });
      })
      .finally(() => {
        setUi((current) => ({ ...current, submitting: false }));
      });
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      return;
    }
    setSelectedIds([]);
    setUi({ error: null, submitting: false });
    onClose();
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="gap-0 rounded-xl border-white/[0.08] bg-[#111215] p-0 sm:max-w-[640px]">
        <DialogHeader className="border-white/[0.06] border-b px-5 pt-5 pb-3">
          <DialogTitle className="font-semibold text-[13px] text-white/90">
            Smart Restore
          </DialogTitle>
          <DialogDescription className="mt-1 text-white/40 text-xs">
            Restore selected tracks from this save into the current active set.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-2 px-5 py-3">
            {loading && (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {!loading && tracks.length === 0 && !error && (
              <div className="py-6 text-center text-[11px] text-white/35">
                No tracks found in this save.
              </div>
            )}

            {tracks.map((track) => {
              const checked = selectedIds.includes(track.id);
              return (
                <button
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    checked
                      ? "border-white/[0.12] bg-white/[0.06]"
                      : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                  )}
                  key={track.id}
                  onClick={() => toggle(track.id)}
                  type="button"
                >
                  <Checkbox
                    checked={checked}
                    className="pointer-events-none mt-0.5"
                    onCheckedChange={() => toggle(track.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge
                        className="h-auto shrink-0 rounded-md px-1.5 py-px text-[9px] uppercase"
                        variant="secondary"
                      >
                        {trackTypeLabel(track.type)}
                      </Badge>
                      <span className="truncate font-medium text-[12px] text-white/75">
                        {track.name}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/35">
                      {track.dependencyTrackIds.length > 0 && (
                        <span>
                          +{track.dependencyTrackIds.length} linked track
                          {track.dependencyTrackIds.length === 1 ? "" : "s"}
                        </span>
                      )}
                      {track.dependencyReturnIds.length > 0 && (
                        <span>
                          +{track.dependencyReturnIds.length} return
                          {track.dependencyReturnIds.length === 1 ? "" : "s"}
                        </span>
                      )}
                      {track.groupId && <span>keeps group routing</span>}
                    </div>
                  </div>
                </button>
              );
            })}

            {error && (
              <div className="rounded-md border border-red-400/15 bg-red-400/10 px-2.5 py-1.5 text-[11px] text-red-300/80">
                {error}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row items-center border-white/[0.06] border-t bg-white/[0.02] px-5 py-3">
          <p className="flex-1 text-[10px] text-white/30">
            Echoform expands group and return dependencies automatically.
          </p>
          <Button
            className="rounded-lg text-[11px]"
            onClick={onClose}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            className="rounded-lg text-[11px]"
            disabled={selectedIds.length === 0 || submitting}
            onClick={handleSubmit}
            size="sm"
            variant="outline"
          >
            {submitting ? "Restoring..." : selectedLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
