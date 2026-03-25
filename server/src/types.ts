// ── Domain Types (producer-native language) ─────────────────────────

export type AppState = {
  roots: TrackedRoot[];
  projects: Project[];
  activity: ActivityItem[];
};

export type TrackedRoot = {
  id: string;
  path: string;
  name: string;
  createdAt: string;
  lastScannedAt: string | null;
  lastError: string | null;
};

export type Project = {
  id: string;
  name: string;
  adapter: 'ableton';
  projectPath: string;
  rootIds: string[];
  presence: 'active' | 'missing';
  watchError: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  currentIdeaId: string;
  pendingOpen: PendingOpen | null;
  driftStatus: DriftStatus | null;
  ideas: Idea[];
  saves: Save[];
  watching: boolean;
};

export type PendingOpen = {
  ideaId: string;
  setPath: string;
  requestedAt: string;
  error: string | null;
};

export type DriftStatus = {
  kind: 'unknown-file' | 'missing-file';
  setPath: string;
  ideaId: string | null;
  detectedAt: string;
};

export type Idea = {
  id: string;
  name: string;
  createdAt: string;
  setPath: string;
  baseSaveId: string;
  headSaveId: string;
  parentIdeaId: string | null;
  forkedFromSaveId: string | null;
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
  trackSummary?: TrackSummaryItem[]; // lightweight track list for visual thumbnails
};

export type TrackSummaryItem = {
  name: string;
  type: 'audio' | 'midi' | 'return' | 'group';
  color: number; // Ableton color palette index
  clipCount: number;
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

export type ActivityItem = {
  id: string;
  kind:
    | 'root-added'
    | 'root-removed'
    | 'root-scanned'
    | 'project-discovered'
    | 'project-missing'
    | 'project-restored'
    | 'auto-saved'
    | 'watcher-error';
  message: string;
  createdAt: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  rootId?: string | null;
  projectId?: string | null;
};

export type RootSuggestion = {
  path: string;
  name: string;
  projectCount: number;
};

// ── WebSocket Events ────────────────────────────────────────────────

export type WsEvent =
  | {
      type: 'snapshot';
      projects: Project[];
      roots: TrackedRoot[];
      activity: ActivityItem[];
    }
  | { type: 'project-updated'; project: Project }
  | { type: 'change-detected'; projectId: string; projectName: string }
  | { type: 'auto-saved'; projectId: string; save: Save }
  | { type: 'error'; message: string }
  | { type: 'discovered-projects'; paths: DiscoveredProject[] }
  | { type: 'root-suggestions'; suggestions: RootSuggestion[] };

export type WsCommand =
  | { type: 'track-project'; projectPath: string; name?: string }
  | { type: 'delete-project'; projectId: string }
  | { type: 'add-root'; path: string; name?: string }
  | { type: 'remove-root'; rootId: string }
  | { type: 'sync-roots' }
  | { type: 'discover-root-suggestions' }
  | { type: 'create-save'; projectId: string; label?: string; note?: string }
  | {
      type: 'branch-from-save';
      projectId: string;
      saveId: string;
      name: string;
      fileName: string;
    }
  | { type: 'open-idea'; projectId: string; ideaId: string }
  | { type: 'reveal-idea-file'; projectId: string; ideaId: string }
  | { type: 'adopt-drift-file'; projectId: string }
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
  rootPath?: string;
};

// ── Disk Usage ──────────────────────────────────────────────────────

export type DiskUsage = {
  projectId: string;
  blobStorageBytes: number; // actual disk used by .ablegit-state/blobs/
  blobCount: number;
  manifestCount: number;
  totalSaveCount: number;
  autoSaveCount: number;
  manualSaveCount: number;
  /** Sum of all saves' metadata.sizeBytes — inflated vs blobStorageBytes due to dedup */
  totalSnapshotBytes: number;
  dedupSavings: number; // totalSnapshotBytes - blobStorageBytes
  saves: DiskUsageSave[];
};

export type DiskUsageSave = {
  id: string;
  label: string;
  createdAt: string;
  snapshotBytes: number;
  auto: boolean;
};

export type SmartRestoreTrack = {
  id: string;
  name: string;
  type: 'audio' | 'midi' | 'group';
  groupId: string | null;
  dependencyTrackIds: string[];
  dependencyReturnIds: string[];
};

export type SmartRestoreResult = {
  restoredTrackCount: number;
  insertedReturnCount: number;
  restoredTrackNames: string[];
  insertedReturnNames: string[];
  backupPath: string;
  targetSetPath: string;
};
