import { create } from "zustand";
import type { Project, Save } from "@/lib/types";

/** Find the nearest previous save (by date) that has a ready preview. */
function findPreviousPreviewSave(project: Project, save: Save): Save | null {
  return (
    project.saves
      .filter(
        (s) =>
          s.id !== save.id &&
          s.previewStatus === "ready" &&
          s.previewRefs.length > 0 &&
          s.createdAt < save.createdAt
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

interface PreviewStore {
  closePreviewPlayer: () => void;
  compareSaveId: string | null;
  openPreviewPlayer: (saveId: string, project?: Project) => void;
  previewPlayerSaveId: string | null;
  reconcilePreviewPlayer: (
    projects: Project[],
    selectedProjectId: string | null
  ) => void;
  setCompareSaveId: (id: string | null) => void;
}

export const usePreviewStore = create<PreviewStore>((set) => ({
  previewPlayerSaveId: null,
  compareSaveId: null,

  openPreviewPlayer: (saveId, project) => {
    let autoCompareId: string | null = null;
    if (project) {
      const save = project.saves.find((s) => s.id === saveId);
      if (save) {
        autoCompareId = findPreviousPreviewSave(project, save)?.id ?? null;
      }
    }
    set({ previewPlayerSaveId: saveId, compareSaveId: autoCompareId });
  },

  closePreviewPlayer: () =>
    set({ previewPlayerSaveId: null, compareSaveId: null }),

  setCompareSaveId: (id) => set({ compareSaveId: id }),

  reconcilePreviewPlayer: (projects, selectedProjectId) =>
    set((state) => {
      if (!(state.previewPlayerSaveId && selectedProjectId)) {
        return { previewPlayerSaveId: null, compareSaveId: null };
      }

      const selectedProject = projects.find(
        (project) => project.id === selectedProjectId
      );
      const previewStillExists = selectedProject?.saves.some(
        (save) => save.id === state.previewPlayerSaveId
      );

      return previewStillExists
        ? state
        : { previewPlayerSaveId: null, compareSaveId: null };
    }),
}));
