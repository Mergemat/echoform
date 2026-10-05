// Re-export types used by the frontend from the server
// This avoids duplication while keeping a single source of truth
export type {
  ActivityItem,
  ChangeWeight,
  ClipAnalysis,
  DiscoveredProject,
  DiskUsage,
  Idea,
  MiniNote,
  PreviewRequestResult,
  PreviewStatus,
  Project,
  RootSuggestion,
  Save,
  SaveAnalysis,
  SaveSummary,
  SetChange,
  TrackAnalysis,
  TrackChange,
  TrackedRoot,
  WsCommand,
  WsEvent,
} from "../../../../packages/server/src/types";

import type { WsCommand as ServerWsCommand } from "../../../../packages/server/src/types";

type WithoutRequestId<T> = T extends { requestId: string }
  ? Omit<T, "requestId">
  : never;

/** Command payload accepted from UI code before the transport adds correlation. */
export type DaemonCommandInput = WithoutRequestId<ServerWsCommand>;
