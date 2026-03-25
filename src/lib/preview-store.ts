import { create } from 'zustand';
import type { Project } from '@/lib/types';

type PreviewStore = {
  previewPlayerSaveId: string | null;
  previewSidebarOpen: boolean;
  openPreviewPlayer: (saveId: string) => void;
  closePreviewPlayer: () => void;
  togglePreviewSidebar: () => void;
  reconcilePreviewPlayer: (
    projects: Project[],
    selectedProjectId: string | null,
  ) => void;
};

export const usePreviewStore = create<PreviewStore>((set) => ({
  previewPlayerSaveId: null,
  previewSidebarOpen: false,

  openPreviewPlayer: (saveId) => set({ previewPlayerSaveId: saveId }),
  closePreviewPlayer: () => set({ previewPlayerSaveId: null }),
  togglePreviewSidebar: () =>
    set((state) => ({ previewSidebarOpen: !state.previewSidebarOpen })),
  reconcilePreviewPlayer: (projects, selectedProjectId) =>
    set((state) => {
      if (!state.previewPlayerSaveId || !selectedProjectId) {
        return { previewPlayerSaveId: null };
      }

      const selectedProject = projects.find(
        (project) => project.id === selectedProjectId,
      );
      const previewStillExists = selectedProject?.saves.some(
        (save) => save.id === state.previewPlayerSaveId,
      );

      return previewStillExists
        ? state
        : {
            previewPlayerSaveId: null,
          };
    }),
}));
