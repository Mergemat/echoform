import { create } from "zustand";
import type {
  ActivityItem,
  DiscoveredProject,
  Project,
  RootSuggestion,
  Save,
  TrackedRoot,
} from "@/lib/types";

interface Store {
  activeIdeaId: string | null;
  activity: ActivityItem[];
  applyProjectUpdate: (project: Project) => void;

  applySnapshot: (
    projects: Project[],
    roots: TrackedRoot[],
    activity: ActivityItem[]
  ) => void;
  discoveredProjects: DiscoveredProject[];
  projects: Project[];
  rootSuggestions: RootSuggestion[];
  rootSuggestionsLoaded: boolean;
  roots: TrackedRoot[];

  selectedProject: () => Project | null;
  selectedProjectId: string | null;
  selectedSave: () => Save | null;
  selectedSaveId: string | null;
  selectProject: (id: string | null) => void;
  setActiveIdea: (id: string) => void;
  setDiscoveredProjects: (projects: DiscoveredProject[]) => void;
  setRootSuggestions: (suggestions: RootSuggestion[]) => void;
  snapshotReceived: boolean;
  toggleSave: (id: string) => void;
}

function applySnapshotSelection(
  projects: Project[],
  selectedProjectId: string | null,
  selectedSaveId: string | null,
  activeIdeaId: string | null
) {
  const nextSelectedProjectId = projects.some(
    (project) => project.id === selectedProjectId
  )
    ? selectedProjectId
    : (projects[0]?.id ?? null);
  const selectedProject =
    projects.find((project) => project.id === nextSelectedProjectId) ?? null;

  return {
    activeIdeaId:
      selectedProject && activeIdeaId
        ? selectedProject.ideas.some((idea) => idea.id === activeIdeaId)
          ? activeIdeaId
          : null
        : null,
    selectedProjectId: nextSelectedProjectId,
    selectedSaveId:
      selectedProject && selectedSaveId
        ? selectedProject.saves.some((save) => save.id === selectedSaveId)
          ? selectedSaveId
          : null
        : null,
  };
}

export const useStore = create<Store>((set, get) => ({
  activeIdeaId: null,
  activity: [],

  applyProjectUpdate: (nextProject) =>
    set((state) => {
      const prevProject = state.projects.find(
        (project) => project.id === nextProject.id
      );
      const followCurrentIdea =
        state.selectedProjectId === nextProject.id &&
        (!state.activeIdeaId ||
          state.activeIdeaId === prevProject?.currentIdeaId);

      return {
        activeIdeaId: followCurrentIdea
          ? nextProject.currentIdeaId
          : state.activeIdeaId,
        projects: state.projects.map((project) =>
          project.id === nextProject.id ? nextProject : project
        ),
        selectedSaveId:
          state.selectedProjectId === nextProject.id &&
          state.selectedSaveId &&
          !nextProject.saves.some((save) => save.id === state.selectedSaveId)
            ? null
            : state.selectedSaveId,
      };
    }),

  applySnapshot: (projects, roots, activity) =>
    set((state) => ({
      activity,
      projects,
      roots,
      snapshotReceived: true,
      ...applySnapshotSelection(
        projects,
        state.selectedProjectId,
        state.selectedSaveId,
        state.activeIdeaId
      ),
    })),
  discoveredProjects: [],
  projects: [],
  rootSuggestions: [],
  rootSuggestionsLoaded: false,
  roots: [],

  selectedProject: () => {
    const { projects, selectedProjectId } = get();
    return projects.find((project) => project.id === selectedProjectId) ?? null;
  },
  selectedProjectId: null,

  selectedSave: () => {
    const project = get().selectedProject();
    const { selectedSaveId } = get();
    if (!(project && selectedSaveId)) {
      return null;
    }
    return project.saves.find((save) => save.id === selectedSaveId) ?? null;
  },
  selectedSaveId: null,

  selectProject: (id) =>
    set({
      activeIdeaId: null,
      selectedProjectId: id,
      selectedSaveId: null,
    }),

  setActiveIdea: (id) =>
    set({
      activeIdeaId: id,
      selectedSaveId: null,
    }),

  setDiscoveredProjects: (projects) => set({ discoveredProjects: projects }),
  setRootSuggestions: (suggestions) =>
    set({ rootSuggestions: suggestions, rootSuggestionsLoaded: true }),
  snapshotReceived: false,

  toggleSave: (id) =>
    set((state) => ({
      selectedSaveId: state.selectedSaveId === id ? null : id,
    })),
}));
