// ── Domain Types (producer-native language) ─────────────────────────

export type AppState = {
  projects: Project[];
};

export type Project = {
  id: string;
  name: string;
  adapter: 'ableton';
  projectPath: string;
  activeSetPath: string;
  createdAt: string;
  updatedAt: string;
  currentIdeaId: string;
  lastRestoredSaveId: string | null;
  ideas: Idea[];
  saves: Save[];
  watching: boolean;
};

export type Idea = {
  id: string;
  name: string;
  createdAt: string;
  baseSaveId: string;
  headSaveId: string;
};

export type Save = {
  id: string;
  label: string;
  note: string;
  createdAt: string;
  ideaId: string;
  previewRefs: string[];
  projectHash: string;
  metadata: ProjectMetadata;
  auto: boolean; // true if created by the watcher automatically
  changes?: ChangeSummary; // diff vs. previous save on the same idea
  setDiff?: SetDiff; // semantic diff of the .als XML vs. previous save
};

export type ProjectMetadata = {
  activeSetPath: string;
  setFiles: string[];
  audioFiles: number;
  fileCount: number;
  sizeBytes: number;
  modifiedAt: string;
};

export type ChangeSummary = {
  addedFiles: string[]; // relative paths of new files
  removedFiles: string[]; // relative paths of deleted files
  modifiedFiles: string[]; // relative paths of files whose size changed
  sizeDelta: number; // bytes gained or lost vs. previous save
};

export type SetDiff = {
  tempoChange: { from: number; to: number } | null;
  timeSignatureChange: { from: string; to: string } | null;
  addedTracks: { name: string; type: string }[];
  removedTracks: { name: string; type: string }[];
  modifiedTracks: TrackDiff[];
};

export type TrackDiff = {
  name: string;
  type: string;
  renamedFrom?: string;
  addedDevices: string[];
  removedDevices: string[];
  clipCountDelta: number;
  addedClips: string[];
  removedClips: string[];
  mixerChanges: string[];
};

export type CompareResult = {
  leftSave: Save;
  rightSave: Save;
  leftIdea: Idea;
  rightIdea: Idea;
  noteChanged: boolean;
  previewRefs: { left: string[]; right: string[] };
  metadataDelta: {
    fileCount: number;
    audioFiles: number;
    sizeBytes: number;
    setCount: number;
    activeSetChanged: boolean;
    modifiedAt: { left: string; right: string };
  };
};

// ── WebSocket Events ────────────────────────────────────────────────

export type WsEvent =
  | { type: 'projects'; projects: Project[] }
  | { type: 'project-updated'; project: Project }
  | { type: 'change-detected'; projectId: string; projectName: string }
  | { type: 'auto-saved'; projectId: string; save: Save }
  | { type: 'error'; message: string }
  | { type: 'discovered-projects'; paths: DiscoveredProject[] };

export type WsCommand =
  | { type: 'track-project'; projectPath: string; name?: string }
  | { type: 'create-save'; projectId: string; label?: string; note?: string }
  | { type: 'create-idea'; projectId: string; fromSaveId: string; name: string }
  | { type: 'go-back-to'; projectId: string; saveId: string; force?: boolean }
  | {
      type: 'compare';
      projectId: string;
      leftSaveId: string;
      rightSaveId: string;
    }
  | {
      type: 'update-save';
      projectId: string;
      saveId: string;
      note?: string;
      label?: string;
    }
  | { type: 'discover-projects' }
  | { type: 'toggle-watching'; projectId: string; watching: boolean }
  | { type: 'delete-save'; projectId: string; saveId: string };

export type DiscoveredProject = {
  path: string;
  name: string;
  setFiles: string[];
  tracked: boolean;
};
