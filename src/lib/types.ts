// Re-export types used by the frontend from the server
// This avoids duplication while keeping a single source of truth
export type {
  Project,
  Save,
  Idea,
  TrackSummaryItem,
  TrackedRoot,
  RootSuggestion,
  ActivityItem,
  DiskUsage,
  DiskUsageSave,
  SmartRestoreTrack,
  SmartRestoreResult,
  CompareResult,
  PreviewRequestResult,
  PreviewStatus,
  WsEvent,
  WsCommand,
  DiscoveredProject,
} from '../../server/src/types';
