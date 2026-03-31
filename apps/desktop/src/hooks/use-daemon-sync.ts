import { useEffect } from "react";
import { toast } from "sonner";
import { useConnectionStore } from "@/lib/connection-store";
import {
  startDaemonClient,
  stopDaemonClient,
  subscribeConnection,
  subscribeDaemonEvents,
} from "@/lib/daemon-client";
import { posthog } from "@/lib/posthog";
import { usePreviewStore } from "@/lib/preview-store";
import { useStore } from "@/lib/store";

export function useDaemonSync() {
  useEffect(() => {
    const unsubscribeEvents = subscribeDaemonEvents((event) => {
      const store = useStore.getState();

      switch (event.type) {
        case "snapshot":
          store.applySnapshot(event.projects, event.roots, event.activity);
          posthog.capture("app_snapshot_received", {
            project_count: event.projects.length,
            root_count: event.roots.length,
            total_saves: event.projects.reduce(
              (sum, p) => sum + p.saves.length,
              0
            ),
          });
          posthog.setPersonProperties({
            project_count: event.projects.length,
            total_saves: event.projects.reduce(
              (sum, p) => sum + p.saves.length,
              0
            ),
          });
          break;
        case "project-updated":
          store.applyProjectUpdate(event.project);
          break;
        case "auto-saved":
          posthog.capture("save_created", {
            auto: true,
            label: event.save.label,
          });
          toast.success(`Auto-saved ${event.save.label}`);
          return;
        case "change-detected":
          posthog.capture("change_detected", {
            project_name: event.projectName,
          });
          toast.info(`Changes detected in ${event.projectName}`);
          return;
        case "discovered-projects":
          store.setDiscoveredProjects(event.paths);
          return;
        case "root-suggestions":
          store.setRootSuggestions(event.suggestions);
          return;
        case "error":
          toast.error(event.message);
          return;
      }

      const nextState = useStore.getState();
      usePreviewStore
        .getState()
        .reconcilePreviewPlayer(
          nextState.projects,
          nextState.selectedProjectId
        );
    });

    const unsubscribeConnection = subscribeConnection((connected) => {
      useConnectionStore.getState().setConnected(connected);
    });

    startDaemonClient();

    return () => {
      unsubscribeEvents();
      unsubscribeConnection();
      stopDaemonClient();
    };
  }, []);
}
