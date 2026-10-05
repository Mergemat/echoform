import { useEffect, useRef } from "react";
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
  // A new branch arrives in the snapshot that follows "recovery-created";
  // remember it so we can switch to it as soon as it exists.
  const pendingBranchIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribeCommandFailures = subscribeCommandFailures(({ error }) => {
      toast.error(error.message);
    });
    const unsubscribeEvents = subscribeDaemonEvents((event) => {
      const store = useStore.getState();

      switch (event.type) {
        case "snapshot":
          store.applySnapshot(event.projects, event.roots, event.activity);
          if (
            pendingBranchIdRef.current &&
            event.projects.some(
              (project) => project.id === pendingBranchIdRef.current
            )
          ) {
            store.selectProject(pendingBranchIdRef.current);
            pendingBranchIdRef.current = null;
          }
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
        case "auto-saved": {
          posthog.capture("save_created", {
            auto: true,
          });
          const projectName = store.projects.find(
            (project) => project.id === event.projectId
          )?.name;
          toast.success("Checkpoint recorded", {
            description: projectName,
          });
          return;
        }
        case "change-detected":
          // The checkpoint itself (or an error) follows; one toast per save.
          return;
        case "discovered-projects":
          store.setDiscoveredProjects(event.paths);
          return;
        case "root-suggestions":
          store.setRootSuggestions(event.suggestions);
          return;
        case "recovery-created": {
          const { openError, recoveredPath, recoveredProjectId } =
            event.recovery;
          pendingBranchIdRef.current = recoveredProjectId;
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
