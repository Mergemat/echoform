import { create } from 'zustand';
import type {
  ActivityItem,
  CompareResult,
  DiscoveredProject,
  Project,
  RootSuggestion,
  Save,
  TrackedRoot,
} from '@/lib/types';

type Store = {
  projects: Project[];
  roots: TrackedRoot[];
  activity: ActivityItem[];
  rootSuggestions: RootSuggestion[];
  rootSuggestionsLoaded: boolean;
  selectedProjectId: string | null;
  selectedSaveId: string | null;
  activeIdeaId: string | null;
  collapsedBranches: Set<string>;
  discoveredProjects: DiscoveredProject[];
  compare: CompareResult | null;

  selectedProject: () => Project | null;
  selectedSave: () => Save | null;

  applySnapshot: (
    projects: Project[],
    roots: TrackedRoot[],
    activity: ActivityItem[],
  ) => void;
  applyProjectUpdate: (project: Project) => void;
  setDiscoveredProjects: (projects: DiscoveredProject[]) => void;
  setRootSuggestions: (suggestions: RootSuggestion[]) => void;
  setCompare: (compare: CompareResult | null) => void;
  selectProject: (id: string | null) => void;
  toggleSave: (id: string) => void;
  setActiveIdea: (id: string) => void;
  toggleBranchCollapse: (ideaId: string) => void;
};

function applySnapshotSelection(
  projects: Project[],
  selectedProjectId: string | null,
  selectedSaveId: string | null,
  activeIdeaId: string | null,
) {
  const nextSelectedProjectId = projects.some(
    (project) => project.id === selectedProjectId,
  )
    ? selectedProjectId
    : (projects[0]?.id ?? null);
  const selectedProject =
    projects.find((project) => project.id === nextSelectedProjectId) ?? null;

  return {
    selectedProjectId: nextSelectedProjectId,
    selectedSaveId:
      selectedProject && selectedSaveId
        ? selectedProject.saves.some((save) => save.id === selectedSaveId)
          ? selectedSaveId
          : null
        : null,
    activeIdeaId:
      selectedProject && activeIdeaId
        ? selectedProject.ideas.some((idea) => idea.id === activeIdeaId)
          ? activeIdeaId
          : null
        : null,
  };
}

export const useStore = create<Store>((set, get) => ({
  projects: [],
  roots: [],
  activity: [],
  rootSuggestions: [],
  rootSuggestionsLoaded: false,
  selectedProjectId: null,
  selectedSaveId: null,
  activeIdeaId: null,
  collapsedBranches: new Set(),
  discoveredProjects: [],
  compare: null,

  selectedProject: () => {
    const { projects, selectedProjectId } = get();
    return projects.find((project) => project.id === selectedProjectId) ?? null;
  },

  selectedSave: () => {
    const project = get().selectedProject();
    const { selectedSaveId } = get();
    if (!project || !selectedSaveId) return null;
    return project.saves.find((save) => save.id === selectedSaveId) ?? null;
  },

  applySnapshot: (projects, roots, activity) =>
    set((state) => ({
      projects,
      roots,
      activity,
      ...applySnapshotSelection(
        projects,
        state.selectedProjectId,
        state.selectedSaveId,
        state.activeIdeaId,
      ),
    })),

  applyProjectUpdate: (nextProject) =>
    set((state) => {
      const prevProject = state.projects.find(
        (project) => project.id === nextProject.id,
      );
      const followCurrentIdea =
        state.selectedProjectId === nextProject.id &&
        (!state.activeIdeaId ||
          state.activeIdeaId === prevProject?.currentIdeaId);

      return {
        projects: state.projects.map((project) =>
          project.id === nextProject.id ? nextProject : project,
        ),
        selectedSaveId:
          state.selectedProjectId === nextProject.id &&
          state.selectedSaveId &&
          !nextProject.saves.some((save) => save.id === state.selectedSaveId)
            ? null
            : state.selectedSaveId,
        activeIdeaId: followCurrentIdea
          ? nextProject.currentIdeaId
          : state.activeIdeaId,
      };
    }),

  setDiscoveredProjects: (projects) => set({ discoveredProjects: projects }),
  setRootSuggestions: (suggestions) =>
    set({ rootSuggestions: suggestions, rootSuggestionsLoaded: true }),
  setCompare: (compare) => set({ compare }),

  selectProject: (id) =>
    set({
      selectedProjectId: id,
      selectedSaveId: null,
      activeIdeaId: null,
      compare: null,
    }),

  toggleSave: (id) =>
    set((state) => ({
      selectedSaveId: state.selectedSaveId === id ? null : id,
    })),

  setActiveIdea: (id) =>
    set((state) => {
      const next = new Set(state.collapsedBranches);
      next.delete(id);
      return {
        activeIdeaId: id,
        selectedSaveId: null,
        collapsedBranches: next,
      };
    }),

  toggleBranchCollapse: (ideaId) =>
    set((state) => {
      const next = new Set(state.collapsedBranches);
      if (next.has(ideaId)) next.delete(ideaId);
      else next.add(ideaId);
      return { collapsedBranches: next };
    }),
}));
