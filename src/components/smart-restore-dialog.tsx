import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { SmartRestoreTrack, SmartRestoreResult } from '@/lib/types';

function trackTypeLabel(type: SmartRestoreTrack['type']): string {
  if (type === 'midi') return 'MIDI';
  if (type === 'audio') return 'Audio';
  return 'Group';
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
  const [tracks, setTracks] = useState<SmartRestoreTrack[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedIds([]);

    fetch(`/api/projects/${projectId}/saves/${saveId}/smart-restore/tracks`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed to load tracks');
        if (!cancelled) setTracks(data.tracks as SmartRestoreTrack[]);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load tracks',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId, saveId]);

  const selectedCount = selectedIds.length;
  const selectedLabel = useMemo(() => {
    if (selectedCount === 0) return 'Select tracks';
    if (selectedCount === 1) return 'Restore 1 track';
    return `Restore ${selectedCount} tracks`;
  }, [selectedCount]);

  const toggle = (trackId: string) => {
    setSelectedIds((current) =>
      current.includes(trackId)
        ? current.filter((id) => id !== trackId)
        : [...current, trackId],
    );
  };

  const handleSubmit = async () => {
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/saves/${saveId}/smart-restore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackIds: selectedIds }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Smart Restore failed');
      onSuccess(data.result as SmartRestoreResult);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smart Restore failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[640px] p-0 gap-0 bg-[#111215] border-white/[0.08] rounded-xl">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
          <DialogTitle className="text-[13px] font-semibold text-white/90">
            Smart Restore
          </DialogTitle>
          <DialogDescription className="text-xs text-white/40 mt-1">
            Restore selected tracks from this save into the current active set.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="px-5 py-3 space-y-2">
            {loading && (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {!loading && tracks.length === 0 && !error && (
              <div className="text-[11px] text-white/35 text-center py-6">
                No tracks found in this save.
              </div>
            )}

            {tracks.map((track) => {
              const checked = selectedIds.includes(track.id);
              return (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => toggle(track.id)}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors w-full text-left',
                    checked
                      ? 'border-white/[0.12] bg-white/[0.06]'
                      : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(track.id)}
                    className="mt-0.5 pointer-events-none"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge
                        variant="secondary"
                        className="text-[9px] uppercase px-1.5 py-px h-auto rounded-md shrink-0"
                      >
                        {trackTypeLabel(track.type)}
                      </Badge>
                      <span className="text-[12px] text-white/75 truncate font-medium">
                        {track.name}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-white/35 flex flex-wrap gap-x-3 gap-y-1">
                      {track.dependencyTrackIds.length > 0 && (
                        <span>
                          +{track.dependencyTrackIds.length} linked track
                          {track.dependencyTrackIds.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {track.dependencyReturnIds.length > 0 && (
                        <span>
                          +{track.dependencyReturnIds.length} return
                          {track.dependencyReturnIds.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {track.groupId && <span>keeps group routing</span>}
                    </div>
                  </div>
                </button>
              );
            })}

            {error && (
              <div className="rounded-md bg-red-400/10 border border-red-400/15 px-2.5 py-1.5 text-[11px] text-red-300/80">
                {error}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="px-5 py-3 border-t border-white/[0.06] bg-white/[0.02] flex-row items-center">
          <p className="flex-1 text-[10px] text-white/30">
            Ablegit expands group and return dependencies automatically.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="rounded-lg text-[11px]"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg text-[11px]"
            onClick={handleSubmit}
            disabled={selectedIds.length === 0 || submitting}
          >
            {submitting ? 'Restoring...' : selectedLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
