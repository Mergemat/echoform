import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { AppSidebar } from '@/components/sidebar';
import { Timeline } from '@/components/timeline';
import { ProjectHeader } from '@/components/project-header';
import { Toaster } from '@/components/ui/sonner';
import { useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 220;
const STORAGE_KEY = 'ablegit:sidebar-width';
const MOBILE_BREAKPOINT = 768;

function readStoredWidth(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) {
      const n = Number(v);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch {}
  return DEFAULT_WIDTH;
}

function readIsMobile(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export function App() {
  const connect = useStore((s) => s.connect);
  const connected = useStore((s) => s.connected);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredWidth);
  const [isMobile, setIsMobile] = useState(readIsMobile);
  const dragging = useRef(false);

  useEffect(() => {
    connect();
  }, [connect]);

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
    } catch {}
  }, []);

  const onDragEnd = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      className={cn(
        'h-screen w-screen overflow-hidden bg-[#0c0c0e] text-white flex',
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
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-20 group"
          >
            <div className="absolute inset-y-0 left-0 w-px bg-white/[0.06] group-hover:bg-white/20 transition-colors" />
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <ProjectHeader />
        <div className="flex-1 min-h-0">
          <Timeline />
        </div>
      </div>

      {/* Connection indicator */}
      {!connected && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 bg-red-500/10 text-red-300 text-[11px] px-3 py-1.5 rounded-full border border-red-500/20 backdrop-blur-sm z-50">
          Connecting to server...
        </div>
      )}

      <Toaster />
    </div>
  );
}

export default App;
