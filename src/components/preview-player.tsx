import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import type { Project, Save } from '@/lib/types';
import WaveSurfer from 'wavesurfer.js';

type Lane = 'a' | 'b';

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

export function PreviewPlayer({
  project,
  save,
  onClose,
}: {
  project: Project;
  save: Save;
  onClose: () => void;
}) {
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

  const [compareSaveId, setCompareSaveId] = useState<string>('');
  const [activeLane, setActiveLane] = useState<Lane>('a');
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playError, setPlayError] = useState<string | null>(null);

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
    (candidate) => candidate.id === compareSaveId,
  )
    ? compareSaveId
    : '';
  const compareSave =
    compareOptions.find((candidate) => candidate.id === effectiveCompareSaveId) ??
    null;
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
    setPlaying(false);
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
    setPlaying(true);
    syncAllVolumes();
  }, [syncAllVolumes]);

  useEffect(() => {
    activeLaneRef.current = effectiveLane;
    hasCompareRef.current = hasCompare;
    setDuration(durationRef.current[effectiveLane] ?? 0);
    syncAllVolumes();
  }, [effectiveLane, hasCompare, syncAllVolumes]);

  useEffect(() => {
    if (!hasCompare && activeLane === 'b') {
      setActiveLane('a');
    }
  }, [activeLane, hasCompare]);

  useEffect(() => {
    const lane: Lane = 'a';
    const container = waveformRefs.current[lane];
    const url = laneUrls[lane];
    if (!container || !url) return;

    const ws = WaveSurfer.create({
      container,
      url,
      height: 32,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      waveColor: 'rgba(255, 255, 255, 0.15)',
      progressColor: 'rgba(255, 255, 255, 0.45)',
      cursorColor: 'rgba(255, 255, 255, 0.5)',
      cursorWidth: 1,
      normalize: true,
      backend: 'WebAudio',
    });

    instancesRef.current[lane] = ws;
    readyRef.current[lane] = false;
    durationRef.current[lane] = 0;

    ws.on('play', () => {
      playingRef.current = true;
      setPlaying(true);
    });
    ws.on('pause', () => {
      if ((['a', 'b'] as const).every((name) => !instancesRef.current[name]?.isPlaying())) {
        playingRef.current = false;
        setPlaying(false);
      }
    });
    ws.on('finish', () => {
      if (lane === 'a' || !hasCompareRef.current) {
        pauseAll();
        currentTimeRef.current = 0;
        setCurrentTime(0);
      }
    });
    ws.on('timeupdate', (time) => {
      currentTimeRef.current = time;
      if (activeLaneRef.current === lane || (lane === 'a' && !hasCompareRef.current)) {
        setCurrentTime(time);
      }
      if (lane === 'a' && readyRef.current.b) {
        syncPlaybackTimes('a');
      }
    });
    ws.on('decode', (dur) => {
      durationRef.current[lane] = dur;
      if (activeLaneRef.current === lane) {
        setDuration(dur);
      }
    });
    ws.on('error', () => {
      setPlayError('Preview file is missing or unreadable.');
      pauseAll();
    });
    ws.on('ready', () => {
      readyRef.current[lane] = true;
      ws.setTime(currentTimeRef.current);
      syncVolumes(lane, ws);
      if (activeLaneRef.current === lane || (lane === 'a' && !hasCompareRef.current)) {
        setCurrentTime(currentTimeRef.current);
        setDuration(durationRef.current[lane] ?? 0);
      }
      if (playingRef.current) {
        void playAllReady().catch((err) => {
          setPlaying(false);
          setPlayError(
            err instanceof Error ? err.message : 'Could not play preview',
          );
        });
      }
    });

    return () => {
      readyRef.current[lane] = false;
      durationRef.current[lane] = 0;
      if (instancesRef.current[lane] === ws) {
        instancesRef.current[lane] = null;
      }
      ws.destroy();
    };
  }, [laneUrls.a, pauseAll, playAllReady, syncPlaybackTimes, syncVolumes]);

  useEffect(() => {
    const lane: Lane = 'b';
    const container = waveformRefs.current[lane];
    const url = laneUrls[lane];

    if (!container || !url || !laneSaves.b) {
      readyRef.current[lane] = false;
      durationRef.current[lane] = 0;
      if (instancesRef.current[lane]) {
        const existing = instancesRef.current[lane];
        instancesRef.current[lane] = null;
        existing.destroy();
      }
      return;
    }

    const ws = WaveSurfer.create({
      container,
      url,
      height: 32,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      waveColor: 'rgba(255, 255, 255, 0.15)',
      progressColor: 'rgba(255, 255, 255, 0.45)',
      cursorColor: 'rgba(255, 255, 255, 0.5)',
      cursorWidth: 1,
      normalize: true,
      backend: 'WebAudio',
    });

    instancesRef.current[lane] = ws;
    readyRef.current[lane] = false;
    durationRef.current[lane] = 0;

    ws.on('play', () => {
      playingRef.current = true;
      setPlaying(true);
    });
    ws.on('pause', () => {
      if ((['a', 'b'] as const).every((name) => !instancesRef.current[name]?.isPlaying())) {
        playingRef.current = false;
        setPlaying(false);
      }
    });
    ws.on('finish', () => {
      pauseAll();
      currentTimeRef.current = 0;
      setCurrentTime(0);
    });
    ws.on('timeupdate', (time) => {
      currentTimeRef.current = time;
      if (activeLaneRef.current === lane) {
        setCurrentTime(time);
      }
    });
    ws.on('decode', (dur) => {
      durationRef.current[lane] = dur;
      if (activeLaneRef.current === lane) {
        setDuration(dur);
      }
    });
    ws.on('error', () => {
      setPlayError('Preview file is missing or unreadable.');
      pauseAll();
    });
    ws.on('ready', () => {
      readyRef.current[lane] = true;
      ws.setTime(currentTimeRef.current);
      syncVolumes(lane, ws);
      if (activeLaneRef.current === lane) {
        setCurrentTime(currentTimeRef.current);
        setDuration(durationRef.current[lane] ?? 0);
      }
      if (readyRef.current.a) {
        ws.setTime(instancesRef.current.a?.getCurrentTime() ?? currentTimeRef.current);
      }
      if (playingRef.current) {
        void playAllReady().catch((err) => {
          setPlaying(false);
          setPlayError(
            err instanceof Error ? err.message : 'Could not play preview',
          );
        });
      }
    });

    return () => {
      readyRef.current[lane] = false;
      durationRef.current[lane] = 0;
      if (instancesRef.current[lane] === ws) {
        instancesRef.current[lane] = null;
      }
      ws.destroy();
    };
  }, [laneSaves.b, laneUrls.b, pauseAll, playAllReady, syncVolumes]);

  const handleTogglePlayback = useCallback(async () => {
    setPlayError(null);

    try {
      if (playingRef.current) {
        pauseAll();
        return;
      }
      await playAllReady();
    } catch (err) {
      setPlaying(false);
      setPlayError(
        err instanceof Error ? err.message : 'Could not play preview',
      );
    }
  }, [pauseAll, playAllReady]);

  const switchLane = useCallback(
    (lane: Lane) => {
      setPlayError(null);
      activeLaneRef.current = lane === 'b' && !hasCompare ? 'a' : lane;
      setActiveLane(lane === 'b' && !hasCompare ? 'a' : lane);
      syncAllVolumes();
    },
    [hasCompare, syncAllVolumes],
  );

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
      } else if (e.key === 'Tab' && compareSave) {
        e.preventDefault();
        switchLane(effectiveLane === 'a' ? 'b' : 'a');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [compareSave, effectiveLane, handleTogglePlayback, switchLane]);

  const handleClose = useCallback(() => {
    pauseAll();
    for (const lane of ['a', 'b'] as const) {
      const instance = instancesRef.current[lane];
      if (!instance) continue;
      instancesRef.current[lane] = null;
      instance.destroy();
    }
    onClose();
  }, [onClose, pauseAll]);

  return (
    <div className="border-t border-border bg-[#0f1014] px-4 py-3">
      <div className="flex items-start gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={handleTogglePlayback}
          disabled={!laneUrls.a}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          className="mt-0.5 shrink-0 rounded-full size-8"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-[10px] uppercase tracking-wider text-white/30 font-medium">
              Preview
            </div>
            <div className="rounded-full border border-white/[0.1] bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/50 font-medium">
              {effectiveLane === 'a' ? 'A' : 'B'}
            </div>
            <div className="text-[10px] text-white/30 font-mono tabular-nums ml-auto">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          <div className="relative mt-2 h-8 overflow-hidden rounded-md">
            <div
              ref={(node) => {
                waveformRefs.current.a = node;
              }}
              className={
                effectiveLane === 'a'
                  ? 'absolute inset-0 opacity-100'
                  : 'pointer-events-none absolute inset-0 opacity-35'
              }
            />
            <div
              ref={(node) => {
                waveformRefs.current.b = node;
              }}
              className={
                compareSave
                  ? effectiveLane === 'b'
                    ? 'absolute inset-0 opacity-100'
                    : 'pointer-events-none absolute inset-0 opacity-35'
                  : 'pointer-events-none absolute inset-0 opacity-0'
              }
            />
          </div>

          <div className="mt-1 text-[13px] font-medium text-white/85">
            {currentSave.label}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={effectiveLane === 'a' ? 'outline' : 'ghost'}
              size="sm"
              className="rounded-lg text-[11px]"
              onClick={() => switchLane('a')}
            >
              A: {save.label}
            </Button>

            <NativeSelect
              value={effectiveCompareSaveId}
              onChange={(event) => {
                const nextId = event.target.value;
                setCompareSaveId(nextId);
                setPlayError(null);
                setActiveLane(nextId ? 'b' : 'a');
              }}
              className="w-[220px] rounded-lg text-[11px]"
            >
              <NativeSelectOption value="">
                Compare with another save
              </NativeSelectOption>
              {compareOptions.map((candidate) => (
                <NativeSelectOption key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>

            {compareSave && (
              <Button
                type="button"
                variant={effectiveLane === 'b' ? 'outline' : 'ghost'}
                size="sm"
                className="rounded-lg text-[11px]"
                onClick={() => switchLane('b')}
              >
                B: {compareSave.label}
              </Button>
            )}

            {compareSave && (
              <span className="text-[10px] text-white/20 ml-1">
                Tab to switch
              </span>
            )}
          </div>

          {playError && (
            <div className="mt-2 rounded-md bg-red-400/10 border border-red-400/15 px-2.5 py-1.5 text-[11px] text-red-300/80">
              {playError}
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleClose}
          className="shrink-0 text-white/30 hover:text-white/65 rounded-full"
        >
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
