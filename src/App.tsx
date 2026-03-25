import { useStore } from '@/lib/store';
import { useConnectionStore } from '@/lib/connection-store';
import { usePreviewStore } from '@/lib/preview-store';
import { AppSidebar } from '@/components/sidebar';
import { Timeline } from '@/components/timeline';
import { ProjectHeader } from '@/components/project-header';
import { PreviewPlayer } from '@/components/preview-player';
import { PreviewSidebar } from '@/components/preview-sidebar';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useDaemonSync } from '@/hooks/use-daemon-sync';
import { usePreviewStatusToasts } from '@/hooks/use-preview-status-toasts';
import { useSidebarLayout } from '@/hooks/use-sidebar-layout';

export function App() {
  useDaemonSync();

  const connected = useConnectionStore((s) => s.connected);
  const selectedProject = useStore((s) => s.selectedProject());
  const projects = useStore((s) => s.projects);
  const previewPlayerSaveId = usePreviewStore((s) => s.previewPlayerSaveId);
  const closePreviewPlayer = usePreviewStore((s) => s.closePreviewPlayer);
  const previewSidebarOpen = usePreviewStore((s) => s.previewSidebarOpen);
  const { isMobile, onDragEnd, onDragMove, onDragStart, sidebarWidth } =
    useSidebarLayout();
  const previewSave =
    selectedProject?.saves.find((save) => save.id === previewPlayerSaveId) ??
    null;

  usePreviewStatusToasts(projects);

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
