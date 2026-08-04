import { useEffect } from "react";
import { toast } from "sonner";
import { useConnectionStore } from "@/lib/connection-store";
import {
  startDaemonClient,
  stopDaemonClient,
  subscribeCommandFailures,
  subscribeConnection,
  subscribeDaemonEvents,
} from "@/lib/daemon-client";
import { posthog, syncAppProfile } from "@/lib/posthog";
import { usePreviewStore } from "@/lib/preview-store";
import { useStore } from "@/lib/store";

export function useDaemonSync() {
  useEffect(() => {
    const unsubscribeCommandFailures = subscribeCommandFailures(({ error }) => {
      toast.error(error.message);
    });
    const unsubscribeEvents = subscribeDaemonEvents((event) => {
      const store = useStore.getState();

      switch (event.type) {
        case "snapshot":
          store.applySnapshot(event.projects, event.roots, event.activity);
          syncAppProfile({
            project_count: event.projects.length,
            root_count: event.roots.length,
            total_saves: event.projects.reduce(
              (sum, project) => sum + project.saves.length,
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
          });
          toast.success(`Checkpoint created for ${event.save.label}`);
          return;
        case "change-detected":
          toast.info(`Changes detected in ${event.projectName}`);
          return;
        case "discovered-projects":
          store.setDiscoveredProjects(event.paths);
          return;
        case "root-suggestions":
          store.setRootSuggestions(event.suggestions);
          return;
        case "recovery-created": {
          const { openError, recoveredPath } = event.recovery;
          const revealPath = window.echoform?.revealPath;
          const options = {
            action: revealPath
              ? {
                  label: "Reveal",
                  onClick: () => {
                    void revealPath(recoveredPath).catch((error) => {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Could not reveal the recovered project."
                      );
                    });
                  },
                }
              : undefined,
            description: recoveredPath,
          };
          if (openError) {
            toast.warning("Branch created, but Ableton did not open", {
              ...options,
              description: `${openError} · ${recoveredPath}`,
            });
          } else {
            toast.success("New branch opened in Ableton", options);
          }
          return;
        }
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
      unsubscribeCommandFailures();
      unsubscribeConnection();
      stopDaemonClient();
    };
  }, []);
}
