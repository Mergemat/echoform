import { PreviewPlayer } from "@/components/preview-player";
import { ProjectHeader } from "@/components/project-header";
import { AppSidebar } from "@/components/sidebar";
import { Timeline } from "@/components/timeline";
import { Toaster } from "@/components/ui/sonner";
import { useDaemonSync } from "@/hooks/use-daemon-sync";
import { usePreviewStatusToasts } from "@/hooks/use-preview-status-toasts";
import { useSidebarLayout } from "@/hooks/use-sidebar-layout";
import { useConnectionStore } from "@/lib/connection-store";
import { usePreviewStore } from "@/lib/preview-store";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

function App() {
  useDaemonSync();

  const connected = useConnectionStore((s) => s.connected);
  const selectedProject = useStore((s) => s.selectedProject());
  const projects = useStore((s) => s.projects);
  const previewPlayerSaveId = usePreviewStore((s) => s.previewPlayerSaveId);
  const closePreviewPlayer = usePreviewStore((s) => s.closePreviewPlayer);
  const { isMobile, onDragEnd, onDragMove, onDragStart, sidebarWidth } =
    useSidebarLayout();
  const previewSave =
    selectedProject?.saves.find((save) => save.id === previewPlayerSaveId) ??
    null;

  usePreviewStatusToasts(projects);

  return (
    <div
      className={cn(
        "flex h-screen w-screen overflow-hidden bg-background text-foreground",
        isMobile ? "flex-col" : "flex-row"
      )}
    >
      {/* Sidebar */}
      <div
        className={cn(
          "relative flex min-w-0",
          isMobile
            ? "h-[38vh] max-h-[360px] min-h-[240px] w-full shrink-0"
            : "shrink-0"
        )}
        style={isMobile ? undefined : { width: sidebarWidth }}
      >
        <AppSidebar />

        {/* Drag handle */}
        {!isMobile && (
          <div
            className="group absolute top-0 right-0 bottom-0 z-20 w-[5px] cursor-col-resize"
            onPointerCancel={onDragEnd}
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors duration-150 group-hover:bg-white/25" />
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ProjectHeader />
          <div className="min-h-0 flex-1">
            <Timeline />
          </div>
          {selectedProject && previewSave && (
            <PreviewPlayer
              key={previewSave.id}
              onClose={closePreviewPlayer}
              project={selectedProject}
              save={previewSave}
            />
          )}
        </div>
      </div>

      {/* Connection indicator */}
      {!connected && (
        <div className="fixed top-3 left-1/2 z-50 -translate-x-1/2 rounded-full border border-red-500/20 bg-red-500/10 px-5 py-2.5 font-medium text-red-300 text-xs shadow-lg shadow-red-500/5 backdrop-blur-md">
          Connecting to daemon...
        </div>
      )}

      <Toaster />
    </div>
  );
}

export default App;
