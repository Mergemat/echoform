import { create } from 'zustand';
import { toast } from 'sonner';
import type {
  ActivityItem,
  CompareResult,
  DiscoveredProject,
  Project,
  RootSuggestion,
  Save,
  TrackedRoot,
  WsCommand,
  WsEvent,
} from '@/lib/types';

const locationLike =
  typeof window !== 'undefined'
    ? window.location
    : { protocol: 'http:', host: 'localhost' };
const wsProtocol = locationLike.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${wsProtocol}//${locationLike.host}/ws`;
const API_URL = '';

type Store = {
  projects: Project[];
  roots: TrackedRoot[];
  activity: ActivityItem[];
  rootSuggestions: RootSuggestion[];
  selectedProjectId: string | null;
  selectedSaveId: string | null;
  activeIdeaId: string | null;
  collapsedBranches: Set<string>;
  discoveredProjects: DiscoveredProject[];
  compare: CompareResult | null;
  previewPlayerSaveId: string | null;
  previewSidebarOpen: boolean;
  connected: boolean;
  ws: WebSocket | null;

  selectedProject: () => Project | null;
  selectedSave: () => Save | null;

  connect: () => Promise<void>;
  send: (cmd: WsCommand) => void;
  selectProject: (id: string | null) => void;
  toggleSave: (id: string) => void;
  setActiveIdea: (id: string) => void;
  toggleBranchCollapse: (ideaId: string) => void;
  openPreviewPlayer: (saveId: string) => void;
  closePreviewPlayer: () => void;
  togglePreviewSidebar: () => void;
  fetchCompare: (
    projectId: string,
    leftId: string,
    rightId: string,
  ) => Promise<void>;
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
  selectedProjectId: null,
  selectedSaveId: null,
  activeIdeaId: null,
  collapsedBranches: new Set(),
  discoveredProjects: [],
  compare: null,
  previewPlayerSaveId: null,
  previewSidebarOpen: false,
  connected: false,
  ws: null,

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

  connect: async () => {
    const currentWs = get().ws;
    if (
      currentWs &&
      (currentWs.readyState === WebSocket.OPEN ||
        currentWs.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/session`);
      if (!res.ok) throw new Error('Session bootstrap failed');
    } catch {
      set({ connected: false, ws: null });
      setTimeout(() => void get().connect(), 2000);
      return;
    }

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => set({ connected: true, ws });

    ws.onclose = () => {
      set({ connected: false, ws: null });
      setTimeout(() => void get().connect(), 2000);
    };

    ws.onmessage = (e) => {
      const event = JSON.parse(e.data) as WsEvent;
      switch (event.type) {
        case 'snapshot':
          set((state) => ({
            projects: event.projects,
            roots: event.roots,
            activity: event.activity,
            previewPlayerSaveId:
              state.selectedProjectId &&
              state.previewPlayerSaveId &&
              event.projects
                .find((project) => project.id === state.selectedProjectId)
                ?.saves.some((save) => save.id === state.previewPlayerSaveId)
                ? state.previewPlayerSaveId
                : null,
            ...applySnapshotSelection(
              event.projects,
              state.selectedProjectId,
              state.selectedSaveId,
              state.activeIdeaId,
            ),
          }));
          break;
        case 'project-updated':
          set((state) => {
            const prevProject = state.projects.find(
              (project) => project.id === event.project.id,
            );
            const followCurrentIdea =
              state.selectedProjectId === event.project.id &&
              (!state.activeIdeaId ||
                state.activeIdeaId === prevProject?.currentIdeaId);

            return {
              projects: state.projects.map((project) =>
                project.id === event.project.id ? event.project : project,
              ),
              previewPlayerSaveId:
                state.selectedProjectId === event.project.id &&
                state.previewPlayerSaveId &&
                !event.project.saves.some(
                  (save) => save.id === state.previewPlayerSaveId,
                )
                  ? null
                  : state.previewPlayerSaveId,
              selectedSaveId:
                state.selectedProjectId === event.project.id &&
                state.selectedSaveId &&
                !event.project.saves.some(
                  (save) => save.id === state.selectedSaveId,
                )
                  ? null
                  : state.selectedSaveId,
              activeIdeaId: followCurrentIdea
                ? event.project.currentIdeaId
                : state.activeIdeaId,
            };
          });
          break;
        case 'auto-saved':
          toast.success(`Auto-saved ${event.save.label}`);
          break;
        case 'change-detected':
          toast.info(`Changes detected in ${event.projectName}`);
          break;
        case 'discovered-projects':
          set({ discoveredProjects: event.paths });
          break;
        case 'root-suggestions':
          set({ rootSuggestions: event.suggestions });
          break;
        case 'error':
          toast.error(event.message);
          break;
      }
    };
  },

  send: (cmd) => {
    const { ws } = get();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(cmd));
    }
  },

  selectProject: (id) =>
    set({
      selectedProjectId: id,
      selectedSaveId: null,
      activeIdeaId: null,
      compare: null,
      previewPlayerSaveId: null,
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
  openPreviewPlayer: (saveId) => set({ previewPlayerSaveId: saveId }),
  closePreviewPlayer: () => set({ previewPlayerSaveId: null }),
  togglePreviewSidebar: () =>
    set((state) => ({ previewSidebarOpen: !state.previewSidebarOpen })),

  fetchCompare: async (projectId, leftId, rightId) => {
    try {
      const res = await fetch(
        `${API_URL}/api/projects/${projectId}/compare?left=${leftId}&right=${rightId}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      set({ compare: data.compare });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Compare failed');
    }
  },
}));
