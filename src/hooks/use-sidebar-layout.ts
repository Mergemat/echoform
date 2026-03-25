import { useCallback, useEffect, useRef, useState } from 'react';

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

export function useSidebarLayout() {
  const [sidebarWidth, setSidebarWidth] = useState(readStoredWidth);
  const [isMobile, setIsMobile] = useState(readIsMobile);
  const dragging = useRef(false);

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

  return {
    isMobile,
    onDragEnd,
    onDragMove,
    onDragStart,
    sidebarWidth,
  };
}
