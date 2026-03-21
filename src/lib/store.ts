import { create } from 'zustand';
import { toast } from 'sonner';
import type {
  Project,
  Save,
  WsEvent,
  WsCommand,
  DiscoveredProject,
  CompareResult,
} from '@/lib/types';

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${wsProtocol}//${window.location.host}/ws`;
const API_URL = '';

type Store = {
  // state
  projects: Project[];
  selectedProjectId: string | null;
  selectedSaveId: string | null;
  /** UI-only: which idea tab is selected. Distinct from server's Project.currentIdeaId (which idea new saves belong to). */
  activeIdeaId: string | null;
  discoveredProjects: DiscoveredProject[];
  compare: CompareResult | null;
  connected: boolean;
  ws: WebSocket | null;

  // computed
  selectedProject: () => Project | null;
  selectedSave: () => Save | null;

  // actions
  connect: () => Promise<void>;
  send: (cmd: WsCommand) => void;
  selectProject: (id: string | null) => void;
  toggleSave: (id: string) => void;
  setActiveIdea: (id: string) => void;
  fetchCompare: (
    projectId: string,
    leftId: string,
    rightId: string,
  ) => Promise<void>;
};

export const useStore = create<Store>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  selectedSaveId: null,
  activeIdeaId: null,
  discoveredProjects: [],
  compare: null,
  connected: false,
  ws: null,

  selectedProject: () => {
    const { projects, selectedProjectId } = get();
    return projects.find((p) => p.id === selectedProjectId) ?? null;
  },

  selectedSave: () => {
    const project = get().selectedProject();
    const { selectedSaveId } = get();
    if (!project || !selectedSaveId) return null;
    return project.saves.find((s) => s.id === selectedSaveId) ?? null;
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
      // reconnect after 2s
      setTimeout(() => void get().connect(), 2000);
    };

    ws.onmessage = (e) => {
      const event = JSON.parse(e.data) as WsEvent;
      switch (event.type) {
        case 'projects':
          set((s) => ({
            projects: event.projects,
            selectedProjectId:
              s.selectedProjectId ?? event.projects[0]?.id ?? null,
          }));
          break;
        case 'project-updated':
          set((s) => ({
            projects: s.projects.map((p) =>
              p.id === event.project.id ? event.project : p,
            ),
            selectedSaveId:
              s.selectedProjectId === event.project.id &&
              s.selectedSaveId &&
              !event.project.saves.some((save) => save.id === s.selectedSaveId)
                ? null
                : s.selectedSaveId,
          }));
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
    }),
  toggleSave: (id) =>
    set((s) => ({ selectedSaveId: s.selectedSaveId === id ? null : id })),
  setActiveIdea: (id) => set({ activeIdeaId: id, selectedSaveId: null }),

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
