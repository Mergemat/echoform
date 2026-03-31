// ── Domain Types (producer-native language) ─────────────────────────

export interface AppState {
  activity: ActivityItem[];
  projects: Project[];
  roots: TrackedRoot[];
}

export interface TrackedRoot {
  createdAt: string;
  id: string;
  lastError: string | null;
  lastScannedAt: string | null;
  name: string;
  path: string;
}

export interface Project {
  adapter: "ableton";
  createdAt: string;
  currentIdeaId: string;
  driftStatus: DriftStatus | null;
  id: string;
  ideas: Idea[];
  lastSeenAt: string | null;
  name: string;
  pendingOpen: PendingOpen | null;
  presence: "active" | "missing";
  projectPath: string;
  rootIds: string[];
  saves: Save[];
  updatedAt: string;
  watchError: string | null;
  watching: boolean;
}

export interface PendingOpen {
  error: string | null;
  ideaId: string;
  requestedAt: string;
  setPath: string;
}

export interface DriftStatus {
  detectedAt: string;
  ideaId: string | null;
  kind: "unknown-file" | "missing-file";
  setPath: string;
}

export interface Idea {
  baseSaveId: string;
  createdAt: string;
  forkedFromSaveId: string | null;
  headSaveId: string;
  id: string;
  name: string;
  parentIdeaId: string | null;
  setPath: string;
}

export interface Save {
  auto: boolean; // true if created by the watcher automatically
  changes?: ChangeSummary; // diff vs. previous save on the same idea
  createdAt: string;
  customLabel?: boolean;
  id: string;
  ideaId: string;
  label: string;
  metadata: ProjectMetadata;
  note: string;
  previewMime: string | null;
  previewRefs: string[];
  previewRequestedAt: string | null;
  previewStatus: PreviewStatus;
  previewUpdatedAt: string | null;
  projectHash: string;
  setDiff?: SetDiff; // semantic diff of the .als XML vs. previous save
  trackSummary?: TrackSummaryItem[]; // lightweight track list for visual thumbnails
}

export type PreviewStatus = "none" | "pending" | "ready" | "missing" | "error";

export interface PreviewRequestResult {
  acceptedExtensions: string[];
  expectedBaseName: string;
  folderPath: string;
  projectId: string;
  saveId: string;
  status: PreviewStatus;
}

export interface TrackSummaryItem {
  children?: TrackSummaryItem[];
  clipCount: number;
  color: number; // Ableton color palette index
  name: string;
  trackCount?: number; // legacy summaries may omit this; groups include nested descendants
  type: "audio" | "midi" | "return" | "group";
}

export interface ProjectMetadata {
  activeSetPath: string;
  audioFiles: number;
  fileCount: number;
  modifiedAt: string;
  setFiles: string[];
  sizeBytes: number;
}

export interface ChangeSummary {
  addedFiles: string[]; // relative paths of new files
  modifiedFiles: string[]; // relative paths of files whose size changed
  removedFiles: string[]; // relative paths of deleted files
  sizeDelta: number; // bytes gained or lost vs. previous save
}

export interface SetDiff {
  addedTracks: { name: string; type: string }[];
  arrangementLengthChange?: { from: number; to: number } | null;
  locatorCountChange?: { from: number; to: number } | null;
  modifiedTracks: TrackDiff[];
  removedTracks: { name: string; type: string }[];
  sceneCountChange?: { from: number; to: number } | null;
  tempoChange: { from: number; to: number } | null;
  timeSignatureChange: { from: string; to: string } | null;
  tracksReordered?: boolean;
}

export interface TrackDiff {
  addedClips: string[];
  addedDevices: string[];
  clipCountDelta: number;
  colorChanged?: boolean;
  deviceToggles?: { name: string; enabled: boolean }[];
  mixerChanges: string[];
  name: string;
  removedClips: string[];
  removedDevices: string[];
  renamedFrom?: string;
  type: string;
}

export interface CompareResult {
  leftIdea: Idea;
  leftSave: Save;
  metadataDelta: {
    fileCount: number;
    audioFiles: number;
    sizeBytes: number;
    setCount: number;
    activeSetChanged: boolean;
    modifiedAt: { left: string; right: string };
  };
  noteChanged: boolean;
  previewRefs: { left: string[]; right: string[] };
  rightIdea: Idea;
  rightSave: Save;
}

export interface ActivityItem {
  createdAt: string;
  id: string;
  kind:
    | "root-added"
    | "root-removed"
    | "root-scanned"
    | "project-discovered"
    | "project-missing"
    | "project-restored"
    | "auto-saved"
    | "watcher-error";
  message: string;
  projectId?: string | null;
  rootId?: string | null;
  severity: "info" | "success" | "warning" | "error";
}

export interface RootSuggestion {
  name: string;
  path: string;
  projectCount: number;
}

// ── WebSocket Events ────────────────────────────────────────────────

export type WsEvent =
  | {
      type: "snapshot";
      projects: Project[];
      roots: TrackedRoot[];
      activity: ActivityItem[];
    }
  | { type: "project-updated"; project: Project }
  | { type: "change-detected"; projectId: string; projectName: string }
  | { type: "auto-saved"; projectId: string; save: Save }
  | { type: "error"; message: string }
  | { type: "discovered-projects"; paths: DiscoveredProject[] }
  | { type: "root-suggestions"; suggestions: RootSuggestion[] };

export type WsCommand =
  | { type: "track-project"; projectPath: string; name?: string }
  | { type: "delete-project"; projectId: string }
  | { type: "add-root"; path: string; name?: string }
  | { type: "remove-root"; rootId: string }
  | { type: "sync-roots" }
  | { type: "discover-root-suggestions" }
  | { type: "create-save"; projectId: string; label?: string; note?: string }
  | {
      type: "branch-from-save";
      projectId: string;
      saveId: string;
      name: string;
      fileName: string;
    }
  | { type: "open-idea"; projectId: string; ideaId: string }
  | { type: "reveal-idea-file"; projectId: string; ideaId: string }
  | { type: "adopt-drift-file"; projectId: string }
  | {
      type: "compare";
      projectId: string;
      leftSaveId: string;
      rightSaveId: string;
    }
  | {
      type: "update-save";
      projectId: string;
      saveId: string;
      note?: string;
      label?: string;
    }
  | { type: "discover-projects" }
  | { type: "toggle-watching"; projectId: string; watching: boolean }
  | { type: "delete-save"; projectId: string; saveId: string };

export interface DiscoveredProject {
  name: string;
  path: string;
  rootPath?: string;
  setFiles: string[];
  tracked: boolean;
}

// ── Disk Usage ──────────────────────────────────────────────────────

export interface DiskUsage {
  autoSaveCount: number;
  blobCount: number;
  blobStorageBytes: number; // actual disk used by the project state dir blobs/
  dedupSavings: number; // totalSnapshotBytes - blobStorageBytes
  eligibleAutoSaveCount: number;
  largestAutoSaveBytes: number;
  manifestCount: number;
  manualSaveCount: number;
  oldestAutoSaveAt: string | null;
  projectId: string;
  saves: DiskUsageSave[];
  totalSaveCount: number;
  /** Sum of all saves' metadata.sizeBytes — inflated vs blobStorageBytes due to dedup */
  totalSnapshotBytes: number;
}

export interface DiskUsageSave {
  auto: boolean;
  createdAt: string;
  customLabel?: boolean;
  id: string;
  label: string;
  snapshotBytes: number;
}
