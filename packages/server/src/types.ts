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
  continuedFrom: ProjectLineage | null;
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

export interface ProjectLineage {
  projectId: string;
  saveId: string;
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
  headSaveId: string;
  id: string;
  name: string;
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
  pinned: boolean;
  previewMime: string | null;
  previewRefs: string[];
  previewRequestedAt: string | null;
  previewStatus: PreviewStatus;
  previewUpdatedAt: string | null;
  projectHash: string;
  /** Musical summary vs. the previous checkpoint of the same set. */
  summary?: SaveSummary;
}

// ── Set analysis ────────────────────────────────────────────────────

/** Bump when analysis output changes so stored summaries are recomputed. */
export const ANALYSIS_VERSION = 1;

export type ChangeWeight = "none" | "minor" | "major";

/** Compact, stored per checkpoint: enough to draw and describe a timeline row. */
export interface SaveSummary {
  /** The checkpoint this one was compared with; stale once that changes. */
  baseSaveId: string | null;
  beatsPerBar: number;
  /** One line a producer would write: "New Serum 2 part in bars 9–16 · Kick +2 dB". */
  headline: string;
  /** Where in the song things changed, in beats, coloured by track. */
  regions: { color: number; end: number; start: number }[];
  /** Arrangement density in fixed buckets (0–1), the song's silhouette. */
  shape: number[];
  lengthBeats: number;
  /** Tracks that changed, in arrangement order. */
  touched: { color: number; name: string }[];
  trackCount: number;
  version: number;
  weight: ChangeWeight;
  /** No earlier checkpoint to compare against. */
  first: boolean;
}

export type ClipStatus = "same" | "added" | "removed" | "moved" | "edited";

export interface MiniNote {
  d: number; // duration, beats
  k: number; // MIDI key
  t: number; // time, beats from clip start
}

export interface ClipAnalysis {
  color: number;
  end: number;
  kind: "midi" | "audio";
  movedFrom: number | null;
  name: string;
  /** For added or edited MIDI clips: notes to draw a piano roll diff. */
  notes: { added: MiniNote[]; kept: MiniNote[]; removed: MiniNote[] } | null;
  sample: string | null;
  start: number;
  status: ClipStatus;
}

export type TrackChange =
  | { type: "renamed"; from: string }
  | { type: "device-added" | "device-removed"; device: string }
  | { type: "device-on" | "device-off"; device: string }
  /** Only the plugin's opaque state changed; may not be a user edit. */
  | { type: "device-state"; device: string }
  | {
      type: "device-settings";
      device: string;
      params: { name: string; from: number; to: number }[];
    }
  | { type: "volume"; from: number; to: number }
  | { type: "pan"; from: number; to: number }
  | { type: "send"; index: number; from: number; to: number }
  | { type: "muted" | "unmuted" | "soloed" | "unsoloed" }
  | {
      type: "automation";
      target: string;
      status: "added" | "removed" | "edited";
    }
  | { type: "session-clips"; from: number; to: number };

export interface TrackAnalysis {
  changes: TrackChange[];
  clips: ClipAnalysis[];
  color: number;
  depth: number;
  id: string;
  name: string;
  status: "same" | "added" | "removed" | "changed";
  type: "audio" | "midi" | "return" | "group";
}

export type SetChange =
  | { type: "tempo"; from: number; to: number }
  | { type: "time-signature"; from: string; to: string }
  | { type: "locator-added" | "locator-removed"; name: string; time: number };

/** Full comparison of one checkpoint with the one before it, served on demand. */
export interface SaveAnalysis {
  baseSaveId: string | null;
  beatsPerBar: number;
  lengthBeats: number;
  locators: { name: string; time: number }[];
  setChanges: SetChange[];
  summary: SaveSummary;
  tempo: number;
  timeSignature: string;
  tracks: TrackAnalysis[];
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
    | "state-recovered"
    | "storage-cleanup-deferred"
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
  | { type: "root-suggestions"; suggestions: RootSuggestion[] }
  | { type: "command-ack"; requestId: string }
  | { type: "command-error"; requestId: string; message: string; code?: number }
  | { type: "recovery-created"; recovery: RecoveryResult };

export type WsCommand = (
  | { type: "track-project"; projectPath: string; name?: string }
  | { type: "delete-project"; projectId: string }
  | { type: "add-root"; path: string; name?: string }
  | { type: "remove-root"; rootId: string }
  | { type: "sync-roots" }
  | { type: "discover-root-suggestions" }
  | { type: "create-save"; projectId: string; label?: string; note?: string }
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
      pinned?: boolean;
    }
  | { type: "discover-projects" }
  | { type: "toggle-watching"; projectId: string; watching: boolean }
  | { type: "delete-save"; projectId: string; saveId: string }
  | { type: "recover-save"; projectId: string; saveId: string; open?: boolean }
  | { type: "relink-project"; projectId: string; projectPath: string }
) & { requestId: string };

export interface RecoveryResult {
  activeSetPath: string;
  openError: string | null;
  recoveredProjectId: string;
  recoveredPath: string;
  sourceProjectId: string;
  sourceSaveId: string;
}

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
