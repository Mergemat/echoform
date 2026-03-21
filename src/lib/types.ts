// Re-export types used by the frontend from the server
// This avoids duplication while keeping a single source of truth
export type {
  Project,
  Save,
  Idea,
  ProjectMetadata,
  ChangeSummary,
  SetDiff,
  TrackDiff,
  TrackSummaryItem,
  DiskUsage,
  DiskUsageSave,
  SmartRestoreTrack,
  SmartRestoreResult,
  CompareResult,
  WsEvent,
  WsCommand,
  DiscoveredProject,
} from '../../server/src/types';
