import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import type { Project, Save } from '@/lib/types';
import WaveSurfer from 'wavesurfer.js';

function mediaUrl(save: Save): string | null {
  const previewRef = save.previewRefs[0];
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
  const waveformRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [compareSaveId, setCompareSaveId] = useState<string>('');
  const [activeLane, setActiveLane] = useState<'a' | 'b'>('a');
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playError, setPlayError] = useState<string | null>(null);

  // Track playback position per lane so A/B switching preserves position
  const positionRef = useRef<{ a: number; b: number }>({ a: 0, b: 0 });

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
    compareOptions.find(
      (candidate) => candidate.id === effectiveCompareSaveId,
    ) ?? null;
  const effectiveLane = activeLane === 'b' && compareSave ? 'b' : 'a';
  const currentSave = effectiveLane === 'b' && compareSave ? compareSave : save;
  const currentUrl = mediaUrl(currentSave);

  // Create / recreate WaveSurfer when URL changes
  useEffect(() => {
    const container = waveformRef.current;
    if (!container || !currentUrl) return;

    const ws = WaveSurfer.create({
      container,
      url: currentUrl,
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

    ws.on('play', () => setPlaying(true));
    ws.on('pause', () => setPlaying(false));
    ws.on('finish', () => setPlaying(false));
    ws.on('timeupdate', (time) => {
      setCurrentTime(time);
      positionRef.current[effectiveLane] = time;
    });
    ws.on('decode', (dur) => setDuration(dur));
    ws.on('error', () => {
      setPlaying(false);
      setPlayError('Preview file is missing or unreadable.');
    });

    // Restore position for this lane
    ws.on('ready', () => {
      const savedPos = positionRef.current[effectiveLane];
      if (savedPos > 0) {
        ws.setTime(savedPos);
      }
    });

    wsRef.current = ws;

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
    // effectiveLane is intentionally in deps so we rebuild when switching lanes
  }, [currentUrl, effectiveLane]);

  const handleTogglePlayback = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || !currentUrl) return;
    try {
      await ws.playPause();
    } catch (err) {
      setPlaying(false);
      setPlayError(
        err instanceof Error ? err.message : 'Could not play preview',
      );
    }
  }, [currentUrl]);

  const switchLane = useCallback(
    (lane: 'a' | 'b') => {
      const ws = wsRef.current;
      const wasPlaying = ws?.isPlaying() ?? false;

      // Save current position before switching
      if (ws) {
        positionRef.current[effectiveLane] = ws.getCurrentTime();
      }

      setPlayError(null);
      setActiveLane(lane);

      // If was playing, auto-play after lane switch (the new WaveSurfer
      // instance will be created by the useEffect and we'll start it via ready event)
      if (wasPlaying) {
        // Small delay to let the new WaveSurfer instance initialize
        const checkAndPlay = () => {
          const newWs = wsRef.current;
          if (newWs) {
            newWs.play().catch(() => {});
          } else {
            requestAnimationFrame(checkAndPlay);
          }
        };
        // Queue the auto-play for after the next render + wavesurfer init
        setTimeout(checkAndPlay, 100);
      }
    },
    [effectiveLane],
  );

  // Keyboard shortcuts: Space = play/pause, Tab = toggle A/B
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
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
  }, [handleTogglePlayback, switchLane, compareSave, effectiveLane]);

  const handleClose = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      ws.pause();
      ws.destroy();
      wsRef.current = null;
    }
    onClose();
  }, [onClose]);

  return (
    <div className="border-t border-border bg-[#0f1014] px-4 py-3">
      <div className="flex items-start gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={handleTogglePlayback}
          disabled={!currentUrl}
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

          {/* Waveform */}
          <div
            ref={waveformRef}
            className="mt-2 rounded-md overflow-hidden cursor-pointer"
          />

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
                if (nextId) {
                  switchLane('b');
                } else {
                  switchLane('a');
                }
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
