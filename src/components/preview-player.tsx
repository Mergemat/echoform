import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import type { Project, Save } from '@/lib/types';
import { usePreviewStore } from '@/lib/preview-store';
import WaveSurfer from 'wavesurfer.js';
import { getSaveDisplayTitle } from './timeline-utils';

type Lane = 'a' | 'b';

// ── Helpers ──────────────────────────────────────────────────────────

function mediaUrl(save: Save | null): string | null {
  const previewRef = save?.previewRefs[0];
  if (!previewRef) return null;
  return `/api/media?path=${encodeURIComponent(previewRef)}`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function relativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

const WS_OPTS = {
  height: 32,
  barWidth: 2,
  barGap: 1,
  barRadius: 1,
  waveColor: 'rgba(255, 255, 255, 0.15)',
  progressColor: 'rgba(255, 255, 255, 0.45)',
  cursorColor: 'rgba(255, 255, 255, 0.5)',
  cursorWidth: 1,
  normalize: true,
  backend: 'WebAudio' as const,
};

// ── Component ────────────────────────────────────────────────────────

type PreviewPlayerProps = {
  project: Project;
  save: Save;
  onClose: () => void;
};

export function PreviewPlayer(props: PreviewPlayerProps) {
  return usePreviewPlayerView(props);
}

function usePreviewPlayerView({
  project,
  save,
  onClose,
}: PreviewPlayerProps) {
  const waveformRefs = useRef<Record<Lane, HTMLDivElement | null>>({
    a: null,
    b: null,
  });
  const instancesRef = useRef<Record<Lane, WaveSurfer | null>>({
    a: null,
    b: null,
  });
  const readyRef = useRef<Record<Lane, boolean>>({ a: false, b: false });
  const durationRef = useRef<Record<Lane, number>>({ a: 0, b: 0 });
  const currentTimeRef = useRef(0);
  const playingRef = useRef(false);
  const activeLaneRef = useRef<Lane>('a');
  const hasCompareRef = useRef(false);

  const storeCompareSaveId = usePreviewStore((s) => s.compareSaveId);
  const setStoreCompareSaveId = usePreviewStore((s) => s.setCompareSaveId);
  const [playerState, setPlayerState] = useState({
    activeLane: 'a' as Lane,
    currentTime: 0,
    duration: 0,
    playError: null as string | null,
    playing: false,
  });
  const { activeLane, currentTime, duration, playError, playing } =
    playerState;

  const compareOptions = useMemo(
    () =>
      [...project.saves]
        .filter(
          (candidate) =>
            candidate.id !== save.id &&
            candidate.previewStatus === 'ready' &&
            candidate.previewRefs.length > 0,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [project.saves, save.id],
  );
  const effectiveCompareSaveId = compareOptions.some(
    (candidate) => candidate.id === storeCompareSaveId,
  )
    ? storeCompareSaveId!
    : '';
  const compareSave =
    compareOptions.find(
      (candidate) => candidate.id === effectiveCompareSaveId,
    ) ?? null;
  const hasCompare = compareSave !== null;
  const effectiveLane = activeLane === 'b' && hasCompare ? 'b' : 'a';
  const currentSave = effectiveLane === 'b' && compareSave ? compareSave : save;

  const laneSaves = useMemo<Record<Lane, Save | null>>(
    () => ({ a: save, b: compareSave }),
    [compareSave, save],
  );
  const laneUrls = useMemo<Record<Lane, string | null>>(
    () => ({ a: mediaUrl(save), b: mediaUrl(compareSave) }),
    [compareSave, save],
  );

  // Determine which save is newer/older for badges
  const isANewer = compareSave ? save.createdAt >= compareSave.createdAt : true;

  const syncVolumes = useCallback((lane: Lane, instance: WaveSurfer | null) => {
    if (!instance) return;
    const audible =
      lane === 'a'
        ? activeLaneRef.current === 'a' || !hasCompareRef.current
        : activeLaneRef.current === 'b' && hasCompareRef.current;
    instance.setVolume(audible ? 1 : 0);
  }, []);

  const syncAllVolumes = useCallback(() => {
    syncVolumes('a', instancesRef.current.a);
    syncVolumes('b', instancesRef.current.b);
  }, [syncVolumes]);

  const syncPlaybackTimes = useCallback((sourceLane: Lane) => {
    const source = instancesRef.current[sourceLane];
    const otherLane: Lane = sourceLane === 'a' ? 'b' : 'a';
    const other = instancesRef.current[otherLane];
    if (!source || !other || !readyRef.current[otherLane]) return;
    const time = source.getCurrentTime();
    currentTimeRef.current = time;
    other.setTime(time);
  }, []);

  const pauseAll = useCallback(() => {
    for (const lane of ['a', 'b'] as const) {
      instancesRef.current[lane]?.pause();
    }
    playingRef.current = false;
    setPlayerState((current) => ({ ...current, playing: false }));
  }, []);

  const disposeAllPlayers = useCallback(() => {
    for (const lane of ['a', 'b'] as const) {
      const instance = instancesRef.current[lane];
      readyRef.current[lane] = false;
      durationRef.current[lane] = 0;
      if (!instance) continue;
      instance.pause();
      instance.destroy();
      instancesRef.current[lane] = null;
    }
    playingRef.current = false;
  }, []);

  const playAllReady = useCallback(async () => {
    const playable = (['a', 'b'] as const).filter(
      (lane) => instancesRef.current[lane] && readyRef.current[lane],
    );
    if (playable.length === 0) return;
    await Promise.all(
      playable.map(async (lane) => {
        const instance = instancesRef.current[lane];
        if (!instance) return;
        instance.setTime(currentTimeRef.current);
        if (!instance.isPlaying()) {
          await instance.play();
        }
      }),
    );
    playingRef.current = true;
    setPlayerState((current) => ({ ...current, playing: true }));
    syncAllVolumes();
  }, [syncAllVolumes]);

  const handleTogglePlayback = useCallback(async () => {
    setPlayerState((current) => ({ ...current, playError: null }));
    try {
      if (playingRef.current) {
        pauseAll();
        return;
      }
      await playAllReady();
    } catch (err) {
      setPlayerState((current) => ({
        ...current,
        playError: err instanceof Error ? err.message : 'Could not play preview',
        playing: false,
      }));
    }
  }, [pauseAll, playAllReady]);

  const switchLane = useCallback(
    (lane: Lane) => {
      const nextLane = lane === 'b' && !hasCompare ? 'a' : lane;
      activeLaneRef.current = lane === 'b' && !hasCompare ? 'a' : lane;
      setPlayerState((current) => ({
        ...current,
        activeLane: nextLane,
        duration: durationRef.current[nextLane] ?? 0,
        playError: null,
      }));
      syncAllVolumes();
    },
    [hasCompare, syncAllVolumes],
  );

  // Stable refs so setupWs never changes identity
  const pauseAllRef = useRef(pauseAll);
  const playAllReadyRef = useRef(playAllReady);
  const syncPlaybackTimesRef = useRef(syncPlaybackTimes);
  const syncVolumesRef = useRef(syncVolumes);

  useEffect(() => {
    pauseAllRef.current = pauseAll;
    playAllReadyRef.current = playAllReady;
    syncPlaybackTimesRef.current = syncPlaybackTimes;
    syncVolumesRef.current = syncVolumes;
  }, [pauseAll, playAllReady, syncPlaybackTimes, syncVolumes]);

  // Shared WaveSurfer factory — stable identity (no callback deps)
  const setupWs = useCallback(
    (lane: Lane, container: HTMLDivElement, url: string): WaveSurfer => {
      const ws = WaveSurfer.create({ container, url, ...WS_OPTS });

      ws.on('play', () => {
        playingRef.current = true;
        setPlayerState((current) => ({ ...current, playing: true }));
      });
      ws.on('pause', () => {
        if (
          (['a', 'b'] as const).every(
            (l) => !instancesRef.current[l]?.isPlaying(),
          )
        ) {
          playingRef.current = false;
          setPlayerState((current) => ({ ...current, playing: false }));
        }
      });
      ws.on('finish', () => {
        pauseAllRef.current();
        currentTimeRef.current = 0;
        setPlayerState((current) => ({ ...current, currentTime: 0 }));
      });
      ws.on('timeupdate', (time) => {
        currentTimeRef.current = time;
        if (activeLaneRef.current === lane) {
          setPlayerState((current) => ({ ...current, currentTime: time }));
        }
        // Only sync from the active lane to avoid ping-pong loop
        if (activeLaneRef.current === lane) {
          const other: Lane = lane === 'a' ? 'b' : 'a';
          if (readyRef.current[other]) {
            syncPlaybackTimesRef.current(lane);
          }
        }
      });
      ws.on('decode', (dur) => {
        durationRef.current[lane] = dur;
        if (activeLaneRef.current === lane) {
          setPlayerState((current) => ({ ...current, duration: dur }));
        }
      });
      ws.on('error', () => {
        setPlayerState((current) => ({
          ...current,
          playError: 'Preview file is missing or unreadable.',
        }));
        pauseAllRef.current();
      });
      ws.on('ready', () => {
        readyRef.current[lane] = true;
        ws.setTime(currentTimeRef.current);
        syncVolumesRef.current(lane, ws);
        if (activeLaneRef.current === lane) {
          setPlayerState((current) => ({
            ...current,
            currentTime: currentTimeRef.current,
            duration: durationRef.current[lane] ?? 0,
          }));
        }
        // Sync to other lane's time if it's already playing
        const other: Lane = lane === 'a' ? 'b' : 'a';
        if (readyRef.current[other]) {
          const otherTime = instancesRef.current[other]?.getCurrentTime();
          if (otherTime !== undefined) ws.setTime(otherTime);
        }
        if (playingRef.current) {
          void playAllReadyRef.current().catch((err) => {
            setPlayerState((current) => ({
              ...current,
              playError:
                err instanceof Error ? err.message : 'Could not play preview',
              playing: false,
            }));
          });
        }
      });

      return ws;
    },
    [],
  );

  // Lane A effect
  useEffect(() => {
    const container = waveformRefs.current.a;
    const url = laneUrls.a;
    const readyState = readyRef.current;
    const durationState = durationRef.current;
    const instances = instancesRef.current;
    if (!container || !url) return;

    const ws = setupWs('a', container, url);
    instances.a = ws;
    readyState.a = false;
    durationState.a = 0;

    return () => {
      readyState.a = false;
      durationState.a = 0;
      if (instances.a === ws) {
        instances.a = null;
        ws.pause();
        ws.destroy();
      }
    };
  }, [laneUrls.a, setupWs]);

  // Lane B effect
  useEffect(() => {
    const container = waveformRefs.current.b;
    const url = laneUrls.b;
    const readyState = readyRef.current;
    const durationState = durationRef.current;
    const instances = instancesRef.current;

    if (!container || !url || !laneSaves.b) {
      readyState.b = false;
      durationState.b = 0;
      if (instances.b) {
        const existing = instances.b;
        instances.b = null;
        existing.destroy();
      }
      return;
    }

    const ws = setupWs('b', container, url);
    instances.b = ws;
    readyState.b = false;
    durationState.b = 0;

    return () => {
      readyState.b = false;
      durationState.b = 0;
      if (instances.b === ws) {
        instances.b = null;
        ws.pause();
        ws.destroy();
      }
    };
  }, [laneSaves.b, laneUrls.b, setupWs]);

  // Sync on lane/compare changes
  useEffect(() => {
    activeLaneRef.current = effectiveLane;
    hasCompareRef.current = hasCompare;
    syncAllVolumes();
    const timer = window.setTimeout(() => {
      setPlayerState((current) => ({
        ...current,
        duration: durationRef.current[effectiveLane] ?? 0,
      }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [effectiveLane, hasCompare, syncAllVolumes]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        void handleTogglePlayback();
      } else if (e.key === '`' && compareSave) {
        e.preventDefault();
        switchLane(effectiveLane === 'a' ? 'b' : 'a');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [compareSave, effectiveLane, handleTogglePlayback, switchLane]);

  useEffect(
    () => () => {
      disposeAllPlayers();
    },
    [disposeAllPlayers],
  );

  const handleClose = useCallback(() => {
    disposeAllPlayers();
    setPlayerState((current) => ({ ...current, playing: false }));
    onClose();
  }, [disposeAllPlayers, onClose]);

  return (
    <div className="border-t border-border bg-background px-5 py-4">
      <div className="flex items-start gap-3">
        {/* Play / Pause */}
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={handleTogglePlayback}
          disabled={!laneUrls.a}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          className="mt-0.5 shrink-0 rounded-full size-8"
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </Button>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          {/* Header: label + time */}
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground/85">
              {getSaveDisplayTitle(currentSave)}
            </span>
            {hasCompare && (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {effectiveLane.toUpperCase()}
              </span>
            )}
            {!hasCompare && (
              <span className="text-[11px] text-muted-foreground">
                {relativeDate(currentSave.createdAt)}
              </span>
            )}
            <span className="ml-auto shrink-0 text-[11px] font-mono tabular-nums text-muted-foreground">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Lane A waveform */}
          <button
            type="button"
            onClick={() => switchLane('a')}
            className={`mt-2 flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all ${
              effectiveLane === 'a'
                ? 'border-border bg-muted/50'
                : 'border-transparent bg-transparent opacity-50 hover:opacity-75'
            }`}
          >
            <span
              className={`inline-flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-bold ${
                effectiveLane === 'a'
                  ? 'bg-foreground/15 text-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              A
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="truncate text-xs text-foreground/70">
                  {getSaveDisplayTitle(save)}
                </span>
                {hasCompare && (
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      isANewer
                        ? 'bg-emerald-400/10 text-emerald-400/80 border border-emerald-400/15'
                        : 'bg-muted text-muted-foreground border border-border'
                    }`}
                  >
                    {isANewer ? 'Newer' : 'Older'}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {relativeDate(save.createdAt)}
                </span>
              </div>
              <div
                ref={(node) => {
                  waveformRefs.current.a = node;
                }}
                className="h-8 rounded"
              />
            </div>
          </button>

          {/* Compare controls */}
          <div className="mt-2 flex items-center gap-2">
            <NativeSelect
              value={effectiveCompareSaveId}
              onChange={(event) => {
                const nextId = event.target.value;
                pauseAll();
                currentTimeRef.current = 0;
                const nextLane = nextId ? 'b' : 'a';
                setStoreCompareSaveId(nextId || null);
                setPlayerState((current) => ({
                  ...current,
                  activeLane: nextLane,
                  currentTime: 0,
                  duration: durationRef.current[nextLane] ?? 0,
                  playError: null,
                }));
              }}
              className="max-w-[260px] flex-1 rounded-lg text-xs"
              aria-label="Compare with another save"
            >
              <NativeSelectOption value="">
                Compare with another save
              </NativeSelectOption>
              {compareOptions.map((candidate) => (
                <NativeSelectOption key={candidate.id} value={candidate.id}>
                  {getSaveDisplayTitle(candidate, { compact: true })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {hasCompare && (
              <span className="text-[11px] text-muted-foreground">
                ` to switch
              </span>
            )}
          </div>

          {/* Lane B waveform (only when compare is active) */}
          {hasCompare && compareSave && (
            <button
              type="button"
              onClick={() => switchLane('b')}
              className={`mt-2 flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all ${
                effectiveLane === 'b'
                  ? 'border-border bg-muted/50'
                  : 'border-transparent bg-transparent opacity-50 hover:opacity-75'
              }`}
            >
              <span
                className={`inline-flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-bold ${
                  effectiveLane === 'b'
                    ? 'bg-foreground/15 text-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                B
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="truncate text-xs text-foreground/70">
                    {getSaveDisplayTitle(compareSave)}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      !isANewer
                        ? 'bg-emerald-400/10 text-emerald-400/80 border border-emerald-400/15'
                        : 'bg-muted text-muted-foreground border border-border'
                    }`}
                  >
                    {!isANewer ? 'Newer' : 'Older'}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {relativeDate(compareSave.createdAt)}
                  </span>
                </div>
                <div
                  ref={(node) => {
                    waveformRefs.current.b = node;
                  }}
                  className="h-8 rounded"
                />
              </div>
            </button>
          )}

          {/* Hidden B container when no compare (WaveSurfer needs a DOM node) */}
          {!hasCompare && (
            <div
              ref={(node) => {
                waveformRefs.current.b = node;
              }}
              className="hidden"
            />
          )}

          {/* Error */}
          {playError && (
            <div className="mt-2 rounded-md bg-destructive/10 border border-destructive/15 px-2.5 py-1.5 text-xs text-destructive">
              {playError}
            </div>
          )}
        </div>

        {/* Close */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleClose}
          aria-label="Close preview player"
          className="shrink-0 text-muted-foreground hover:text-foreground rounded-full"
        >
          <X size={16} />
        </Button>
      </div>
    </div>
  );
}
