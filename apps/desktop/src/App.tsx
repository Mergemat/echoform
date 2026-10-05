import { useEffect, useRef } from "react";
import { Logo } from "@/components/logo";
import { PreviewPlayer } from "@/components/preview-player";
import { ProjectHeader } from "@/components/project-header";
import { AppSidebar } from "@/components/sidebar";
import { Timeline } from "@/components/timeline";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WelcomeOnboarding } from "@/components/welcome-onboarding";
import { useDaemonSync } from "@/hooks/use-daemon-sync";
import { usePreviewStatusToasts } from "@/hooks/use-preview-status-toasts";
import { useConnectionStore } from "@/lib/connection-store";
import { useOnboardingStore } from "@/lib/onboarding-store";
import { posthog } from "@/lib/posthog";
import { usePreviewStore } from "@/lib/preview-store";
import { useStore } from "@/lib/store";

function AppLoading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Logo className="size-8 animate-pulse text-muted-foreground" />
        <span className="text-[13px] text-muted-foreground">
          Starting Echoform…
        </span>
      </div>
    </div>
  );
}

function ConnectionBanner() {
  const connected = useConnectionStore((s) => s.connected);
  if (connected) {
    return null;
  }
  return (
    <div
      className="border-warning/20 border-b bg-warning/10 px-6 py-2 text-[12px] text-warning"
      role="status"
    >
      Lost connection to Echoform's background service. Reconnecting — saves
      made in Ableton meanwhile are picked up once it's back.
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
  const previewSave =
    selectedProject?.saves.find((save) => save.id === previewPlayerSaveId) ??
    null;
  const readyCapturedRef = useRef(false);

  usePreviewStatusToasts(projects);

  useEffect(() => {
    if (readyCapturedRef.current || !(connected && snapshotReceived)) {
      return;
    }

    readyCapturedRef.current = true;
    posthog.capture("app_ready", {
      onboarding_completed: onboardingStep === "done",
      project_count: projects.length,
    });
  }, [connected, onboardingStep, projects.length, snapshotReceived]);

  // Only block on the very first snapshot; later disconnects show a banner
  // so the user keeps seeing their history.
  if (!snapshotReceived) {
    return (
      <>
        <AppLoading />
        <Toaster />
      </>
    );
  }

  if (onboardingStep !== "done") {
    return (
      <TooltipProvider delayDuration={400}>
        <WelcomeOnboarding />
        <Toaster />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <div className="w-[248px] shrink-0">
          <AppSidebar />
        </div>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ConnectionBanner />
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
        </main>

        <Toaster />
      </div>
    </TooltipProvider>
  );
}

export default App;
