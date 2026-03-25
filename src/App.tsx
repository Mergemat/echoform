import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { AppSidebar } from '@/components/sidebar';
import { Timeline } from '@/components/timeline';
import { ProjectHeader } from '@/components/project-header';
import { PreviewPlayer } from '@/components/preview-player';
import { PreviewSidebar } from '@/components/preview-sidebar';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { PreviewStatus } from '@/lib/types';

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 260;
const STORAGE_KEY = 'ablegit:sidebar-width';
const MOBILE_BREAKPOINT = 768;

function readStoredWidth(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) {
      const n = Number(v);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch {
    // Ignore storage access errors and fall back to the default width.
  }
  return DEFAULT_WIDTH;
}

function readIsMobile(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export function App() {
  const connect = useStore((s) => s.connect);
  const connected = useStore((s) => s.connected);
  const selectedProject = useStore((s) => s.selectedProject());
  const projects = useStore((s) => s.projects);
  const previewPlayerSaveId = useStore((s) => s.previewPlayerSaveId);
  const closePreviewPlayer = useStore((s) => s.closePreviewPlayer);
  const previewSidebarOpen = useStore((s) => s.previewSidebarOpen);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredWidth);
  const [isMobile, setIsMobile] = useState(readIsMobile);
  const dragging = useRef(false);
  const prevPreviewStatuses = useRef<Map<string, PreviewStatus>>(new Map());
  const previewSave =
    selectedProject?.saves.find((save) => save.id === previewPlayerSaveId) ??
    null;

  useEffect(() => {
    connect();
  }, [connect]);

  // Detect preview status transitions: pending → ready → toast
  useEffect(() => {
    const prev = prevPreviewStatuses.current;
    const next = new Map<string, PreviewStatus>();

    for (const project of projects) {
      for (const save of project.saves) {
        next.set(save.id, save.previewStatus);
        const was = prev.get(save.id);
        if (was === 'pending' && save.previewStatus === 'ready') {
          toast.success(`Preview attached to "${save.label}"`);
        }
      }
    }

    prevPreviewStatuses.current = next;
  }, [projects]);

  useEffect(() => {
    const handleResize = () => setIsMobile(readIsMobile());
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
    setSidebarWidth(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Ignore storage access errors during drag resize.
    }
  }, []);

  const onDragEnd = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      className={cn(
        'h-screen w-screen overflow-hidden bg-background text-foreground flex',
        isMobile ? 'flex-col' : 'flex-row',
      )}
    >
      {/* Sidebar */}
      <div
        className={cn(
          'relative flex min-w-0',
          isMobile
            ? 'h-[38vh] min-h-[240px] max-h-[360px] w-full shrink-0'
            : 'shrink-0',
        )}
        style={isMobile ? undefined : { width: sidebarWidth }}
      >
        <AppSidebar />

        {/* Drag handle */}
        {!isMobile && (
          <div
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-20 group"
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-white/25 transition-colors duration-150" />
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-w-0 min-h-0">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <ProjectHeader />
          <div className="flex-1 min-h-0">
            <Timeline />
          </div>
          {selectedProject && previewSave && (
            <PreviewPlayer
              key={previewSave.id}
              project={selectedProject}
              save={previewSave}
              onClose={closePreviewPlayer}
            />
          )}
        </div>

        {/* Right sidebar: all previews */}
        {selectedProject && previewSidebarOpen && !isMobile && (
          <div className="shrink-0 w-[220px]">
            <PreviewSidebar project={selectedProject} />
          </div>
        )}
      </div>

      {/* Connection indicator */}
      {!connected && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 bg-red-500/10 text-red-300 text-[11px] font-medium px-4 py-2 rounded-full border border-red-500/20 backdrop-blur-md z-50 shadow-lg shadow-red-500/5">
          Connecting to daemon...
        </div>
      )}

      <Toaster />
    </div>
  );
}

export default App;
