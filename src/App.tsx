import { PreviewPlayer } from "@/components/preview-player";
import { ProjectHeader } from "@/components/project-header";
import { AppSidebar } from "@/components/sidebar";
import { Timeline } from "@/components/timeline";
import { Toaster } from "@/components/ui/sonner";
import { WelcomeOnboarding } from "@/components/welcome-onboarding";
import { useDaemonSync } from "@/hooks/use-daemon-sync";
import { usePreviewStatusToasts } from "@/hooks/use-preview-status-toasts";
import { useSidebarLayout } from "@/hooks/use-sidebar-layout";
import { useConnectionStore } from "@/lib/connection-store";
import { useOnboardingStore } from "@/lib/onboarding-store";
import { usePreviewStore } from "@/lib/preview-store";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

function AppLoading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <div className="h-1 w-24 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full w-2/5 animate-[shimmer_1.6s_ease-in-out_infinite] rounded-full bg-white/15" />
        </div>
        <span className="text-[13px] text-white/20">Loading projects...</span>
      </div>
    </div>
  );
}

function ConnectionIndicator() {
  const connected = useConnectionStore((s) => s.connected);
  const snapshotReceived = useStore((s) => s.snapshotReceived);

  // Don't show "reconnecting" on first load — the app loading screen handles it
  if (!snapshotReceived) {
    return null;
  }

  if (connected) {
    return null;
  }

  return (
    <div className="fade-in slide-in-from-top-2 fixed top-3 left-1/2 z-50 -translate-x-1/2 animate-in duration-300">
      <div className="flex items-center gap-2.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-[12px] text-white/40 shadow-black/20 shadow-lg backdrop-blur-xl">
        <div className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-400/70" />
        Reconnecting...
      </div>
    </div>
  );
}

function App() {
  useDaemonSync();

  const connected = useConnectionStore((s) => s.connected);
  const snapshotReceived = useStore((s) => s.snapshotReceived);
  const selectedProject = useStore((s) => s.selectedProject());
  const projects = useStore((s) => s.projects);
  const onboardingStep = useOnboardingStore((s) => s.step);
  const previewPlayerSaveId = usePreviewStore((s) => s.previewPlayerSaveId);
  const closePreviewPlayer = usePreviewStore((s) => s.closePreviewPlayer);
  const { isMobile, onDragEnd, onDragMove, onDragStart, sidebarWidth } =
    useSidebarLayout();
  const previewSave =
    selectedProject?.saves.find((save) => save.id === previewPlayerSaveId) ??
    null;

  usePreviewStatusToasts(projects);

  // Show loading screen while waiting for initial connection + snapshot
  if (!(connected && snapshotReceived)) {
    return (
      <>
        <AppLoading />
        <Toaster />
      </>
    );
  }

  // Show onboarding when not completed yet
  if (onboardingStep !== "done") {
    return (
      <>
        <WelcomeOnboarding />
        <Toaster />
      </>
    );
  }

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

      <ConnectionIndicator />
      <Toaster />
    </div>
  );
}

export default App;
