// Re-export types used by the frontend from the server
// This avoids duplication while keeping a single source of truth
export type {
  ActivityItem,
  CompareResult,
  DiscoveredProject,
  DiskUsage,
  DiskUsageSave,
  Idea,
  PreviewRequestResult,
  PreviewStatus,
  Project,
  RootSuggestion,
  Save,
  SmartRestoreResult,
  SmartRestoreTrack,
  TrackedRoot,
  TrackSummaryItem,
  WsCommand,
  WsEvent,
} from "../../server/src/types";
