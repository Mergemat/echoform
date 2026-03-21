import { create } from "zustand";
import type { Project, Save, WsEvent, WsCommand, DiscoveredProject, CompareResult } from "@/lib/types";

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const WS_URL = `${wsProtocol}//${window.location.host}/ws`;
const API_URL = "";

type Toast = {
  id: string;
  message: string;
  type: "info" | "success" | "error";
  createdAt: number;
};

type Store = {
  // state
  projects: Project[];
  selectedProjectId: string | null;
  selectedSaveId: string | null;
  discoveredProjects: DiscoveredProject[];
  compare: CompareResult | null;
  toasts: Toast[];
  connected: boolean;
  ws: WebSocket | null;

  // computed
  selectedProject: () => Project | null;
  selectedSave: () => Save | null;

  // actions
  connect: () => void;
  send: (cmd: WsCommand) => void;
  selectProject: (id: string | null) => void;
  selectSave: (id: string | null) => void;
  fetchCompare: (projectId: string, leftId: string, rightId: string) => Promise<void>;
  addToast: (message: string, type?: Toast["type"]) => void;
  dismissToast: (id: string) => void;
};

export const useStore = create<Store>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  selectedSaveId: null,
  discoveredProjects: [],
  compare: null,
  toasts: [],
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

  connect: () => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => set({ connected: true, ws });

    ws.onclose = () => {
      set({ connected: false, ws: null });
      // reconnect after 2s
      setTimeout(() => get().connect(), 2000);
    };

    ws.onmessage = (e) => {
      const event = JSON.parse(e.data) as WsEvent;
      switch (event.type) {
        case "projects":
          set((s) => ({
            projects: event.projects,
            selectedProjectId: s.selectedProjectId ?? event.projects[0]?.id ?? null,
          }));
          break;
        case "project-updated":
          set((s) => ({
            projects: s.projects.map((p) => (p.id === event.project.id ? event.project : p)),
          }));
          break;
        case "auto-saved":
          get().addToast(`Auto-saved ${event.save.label}`, "success");
          break;
        case "change-detected":
          get().addToast(`Changes detected in ${event.projectName}`, "info");
          break;
        case "discovered-projects":
          set({ discoveredProjects: event.paths });
          break;
        case "error":
          get().addToast(event.message, "error");
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

  selectProject: (id) => set({ selectedProjectId: id, selectedSaveId: null, compare: null }),
  selectSave: (id) => set({ selectedSaveId: id }),

  fetchCompare: async (projectId, leftId, rightId) => {
    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}/compare?left=${leftId}&right=${rightId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      set({ compare: data.compare });
    } catch (err) {
      get().addToast(err instanceof Error ? err.message : "Compare failed", "error");
    }
  },

  addToast: (message, type = "info") => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message, type, createdAt: Date.now() }] }));
    setTimeout(() => get().dismissToast(id), 4000);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
