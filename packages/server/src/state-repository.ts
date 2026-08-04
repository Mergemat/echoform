import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ActivityItem,
  AppState,
  Idea,
  Project,
  Save,
  TrackedRoot,
} from "./types";

export type FileOperations = Pick<
  typeof import("node:fs/promises"),
  "mkdir" | "readFile" | "rename" | "rm" | "writeFile"
>;

const defaultFileOperations: FileOperations = {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
};

export class StateRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StateRepositoryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isNumberChange(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["from", "to"]) &&
    isFiniteNumber(value.from) &&
    isFiniteNumber(value.to)
  );
}

function isStringChange(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["from", "to"]) &&
    isString(value.from) &&
    isString(value.to)
  );
}

function isNullableNumberChange(value: unknown): boolean {
  return value === null || isNumberChange(value);
}

function isNamedType(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["name", "type"]) &&
    isString(value.name) &&
    isString(value.type)
  );
}

function isTrackDiff(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "addedClips",
      "addedDevices",
      "clipCountDelta",
      "colorChanged",
      "deviceToggles",
      "mixerChanges",
      "name",
      "removedClips",
      "removedDevices",
      "renamedFrom",
      "type",
    ]) &&
    isStringArray(value.addedClips) &&
    isStringArray(value.addedDevices) &&
    isFiniteNumber(value.clipCountDelta) &&
    typeof value.colorChanged === "boolean" &&
    Array.isArray(value.deviceToggles) &&
    value.deviceToggles.every(
      (toggle) =>
        isRecord(toggle) &&
        hasOnlyKeys(toggle, ["name", "enabled"]) &&
        isString(toggle.name) &&
        typeof toggle.enabled === "boolean",
    ) &&
    isStringArray(value.mixerChanges) &&
    isString(value.name) &&
    isStringArray(value.removedClips) &&
    isStringArray(value.removedDevices) &&
    isOptionalString(value.renamedFrom) &&
    isString(value.type)
  );
}

function isSetDiff(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "addedTracks",
      "arrangementLengthChange",
      "locatorCountChange",
      "modifiedTracks",
      "removedTracks",
      "sceneCountChange",
      "tempoChange",
      "timeSignatureChange",
      "tracksReordered",
    ]) &&
    Array.isArray(value.addedTracks) &&
    value.addedTracks.every(isNamedType) &&
    isNullableNumberChange(value.arrangementLengthChange) &&
    isNullableNumberChange(value.locatorCountChange) &&
    Array.isArray(value.modifiedTracks) &&
    value.modifiedTracks.every(isTrackDiff) &&
    Array.isArray(value.removedTracks) &&
    value.removedTracks.every(isNamedType) &&
    isNullableNumberChange(value.sceneCountChange) &&
    (value.tempoChange === null || isNumberChange(value.tempoChange)) &&
    (value.timeSignatureChange === null ||
      isStringChange(value.timeSignatureChange)) &&
    typeof value.tracksReordered === "boolean"
  );
}

function isChangeSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "addedFiles",
      "modifiedFiles",
      "removedFiles",
      "sizeDelta",
    ]) &&
    isStringArray(value.addedFiles) &&
    isStringArray(value.modifiedFiles) &&
    isStringArray(value.removedFiles) &&
    isFiniteNumber(value.sizeDelta)
  );
}

function isTrackSummaryItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "children",
      "clipCount",
      "color",
      "name",
      "trackCount",
      "type",
    ]) &&
    (value.children === undefined ||
      (Array.isArray(value.children) &&
        value.children.every(isTrackSummaryItem))) &&
    isFiniteNumber(value.clipCount) &&
    isFiniteNumber(value.color) &&
    isString(value.name) &&
    isFiniteNumber(value.trackCount) &&
    ["audio", "midi", "return", "group"].includes(String(value.type))
  );
}

function isIdea(value: unknown): value is Idea {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "baseSaveId",
      "createdAt",
      "headSaveId",
      "id",
      "name",
      "setPath",
    ]) &&
    ["id", "name", "createdAt", "setPath", "baseSaveId", "headSaveId"].every(
      (key) => isString(value[key]),
    )
  );
}

function isSave(value: unknown): value is Save {
  if (!isRecord(value) || !isRecord(value.metadata)) {
    return false;
  }
  const metadata = value.metadata;
  return (
    ["id", "label", "note", "createdAt", "ideaId", "projectHash"].every((key) =>
      isString(value[key]),
    ) &&
    typeof value.auto === "boolean" &&
    isOptionalBoolean(value.customLabel) &&
    (value.changes === undefined || isChangeSummary(value.changes)) &&
    typeof value.pinned === "boolean" &&
    isStringArray(value.previewRefs) &&
    ["none", "pending", "ready", "missing", "error"].includes(
      String(value.previewStatus),
    ) &&
    isNullableString(value.previewMime) &&
    isNullableString(value.previewRequestedAt) &&
    isNullableString(value.previewUpdatedAt) &&
    (value.setDiff === undefined || isSetDiff(value.setDiff)) &&
    (value.trackSummary === undefined ||
      (Array.isArray(value.trackSummary) &&
        value.trackSummary.every(isTrackSummaryItem))) &&
    ["activeSetPath", "modifiedAt"].every((key) => isString(metadata[key])) &&
    isStringArray(metadata.setFiles) &&
    ["audioFiles", "fileCount", "sizeBytes"].every(
      (key) =>
        typeof metadata[key] === "number" && Number.isFinite(metadata[key]),
    )
  );
}

function isPendingOpen(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["ideaId", "requestedAt", "setPath"].every((key) => isString(value[key])) &&
    isNullableString(value.error)
  );
}

function isDriftStatus(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.detectedAt) &&
    isNullableString(value.ideaId) &&
    (value.kind === "unknown-file" || value.kind === "missing-file") &&
    isString(value.setPath)
  );
}

function isProjectLineage(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["projectId", "saveId"]) &&
    isString(value.projectId) &&
    isString(value.saveId)
  );
}

function isProject(value: unknown): value is Project {
  return (
    isRecord(value) &&
    value.adapter === "ableton" &&
    [
      "id",
      "name",
      "projectPath",
      "createdAt",
      "updatedAt",
      "currentIdeaId",
    ].every((key) => isString(value[key])) &&
    (value.continuedFrom === null || isProjectLineage(value.continuedFrom)) &&
    isStringArray(value.rootIds) &&
    (value.presence === "active" || value.presence === "missing") &&
    typeof value.watching === "boolean" &&
    isNullableString(value.watchError) &&
    isNullableString(value.lastSeenAt) &&
    (value.pendingOpen === null || isPendingOpen(value.pendingOpen)) &&
    (value.driftStatus === null || isDriftStatus(value.driftStatus)) &&
    Array.isArray(value.ideas) &&
    value.ideas.every(isIdea) &&
    Array.isArray(value.saves) &&
    value.saves.every(isSave)
  );
}

function isRoot(value: unknown): value is TrackedRoot {
  return (
    isRecord(value) &&
    ["id", "name", "path", "createdAt"].every((key) => isString(value[key])) &&
    isNullableString(value.lastError) &&
    isNullableString(value.lastScannedAt)
  );
}

function isActivity(value: unknown): value is ActivityItem {
  const kinds = new Set<ActivityItem["kind"]>([
    "root-added",
    "root-removed",
    "root-scanned",
    "project-discovered",
    "project-missing",
    "project-restored",
    "auto-saved",
    "state-recovered",
    "storage-cleanup-deferred",
    "watcher-error",
  ]);
  const severities = new Set<ActivityItem["severity"]>([
    "info",
    "success",
    "warning",
    "error",
  ]);
  return (
    isRecord(value) &&
    ["id", "message", "createdAt"].every((key) => isString(value[key])) &&
    kinds.has(value.kind as ActivityItem["kind"]) &&
    severities.has(value.severity as ActivityItem["severity"]) &&
    (value.projectId === undefined || isNullableString(value.projectId)) &&
    (value.rootId === undefined || isNullableString(value.rootId))
  );
}

export function validateAppState(value: unknown): AppState {
  if (
    !isRecord(value) ||
    !Array.isArray(value.roots) ||
    !value.roots.every(isRoot) ||
    !Array.isArray(value.projects) ||
    !value.projects.every(isProject) ||
    !Array.isArray(value.activity) ||
    !value.activity.every(isActivity)
  ) {
    throw new StateRepositoryError("Persisted state has an invalid structure.");
  }

  const projectIds = new Set<string>();
  for (const project of value.projects) {
    if (projectIds.has(project.id)) {
      throw new StateRepositoryError(
        `Persisted state contains duplicate project ${project.id}.`,
      );
    }
    projectIds.add(project.id);
    const ideaIds = new Set(project.ideas.map((idea) => idea.id));
    const saveIds = new Set(project.saves.map((save) => save.id));
    if (ideaIds.size !== project.ideas.length) {
      throw new StateRepositoryError(
        `Project ${project.id} contains duplicate ideas.`,
      );
    }
    if (saveIds.size !== project.saves.length) {
      throw new StateRepositoryError(
        `Project ${project.id} contains duplicate saves.`,
      );
    }
    if (!ideaIds.has(project.currentIdeaId)) {
      throw new StateRepositoryError(
        `Project ${project.id} points to a missing current idea.`,
      );
    }
    for (const idea of project.ideas) {
      for (const saveId of [idea.baseSaveId, idea.headSaveId]) {
        if (saveId && !saveIds.has(saveId)) {
          throw new StateRepositoryError(
            `Idea ${idea.id} points to a missing save.`,
          );
        }
      }
    }
    if (project.saves.some((save) => !ideaIds.has(save.ideaId))) {
      throw new StateRepositoryError(
        `Project ${project.id} contains a save for a missing idea.`,
      );
    }
  }
  return value as unknown as AppState;
}

function isErrno(error: unknown, code: string): boolean {
  return (
    isRecord(error) &&
    "code" in error &&
    (error as unknown as NodeJS.ErrnoException).code === code
  );
}

function parseState(content: string, path: string): AppState {
  try {
    return validateAppState(JSON.parse(content));
  } catch (error) {
    throw new StateRepositoryError(
      `Cannot load ${path}: ${error instanceof Error ? error.message : "invalid JSON"}`,
      {
        cause: error,
      },
    );
  }
}

export interface LoadedState {
  recoveredFromPrevious: boolean;
  state: AppState;
}

/** Owns validation, crash recovery, and atomic generation rotation for app state. */
export class StateRepository {
  readonly currentPath: string;
  readonly previousPath: string;
  private readonly previousTemporaryPath: string;
  private readonly temporaryPath: string;

  constructor(
    private readonly rootDir: string,
    private readonly files: FileOperations = defaultFileOperations,
  ) {
    this.currentPath = join(rootDir, "state.json");
    this.previousPath = join(rootDir, "state.previous.json");
    this.previousTemporaryPath = join(rootDir, "state.previous.next.json");
    this.temporaryPath = join(rootDir, "state.next.json");
  }

  private quarantinePath(generation: "current" | "previous"): string {
    return join(
      this.rootDir,
      `state.incompatible.${generation}.${Date.now()}-${crypto.randomUUID()}.json`,
    );
  }

  private async quarantine(
    sourcePath: string,
    generation: "current" | "previous",
  ): Promise<string> {
    const destination = this.quarantinePath(generation);
    await this.files.rename(sourcePath, destination);
    return destination;
  }

  private emptyStateAfterQuarantine(paths: string[]): LoadedState {
    const now = new Date().toISOString();
    return {
      state: {
        roots: [],
        projects: [],
        activity: [
          {
            id: `activity_state_quarantined_${crypto.randomUUID()}`,
            kind: "state-recovered",
            message: `Echoform preserved incompatible state at ${paths.join(
              " and ",
            )} and started with empty history metadata. Project files were not changed.`,
            severity: "warning",
            createdAt: now,
          },
        ],
      },
      recoveredFromPrevious: false,
    };
  }

  async load(): Promise<LoadedState> {
    await this.files.mkdir(this.rootDir, { recursive: true });
    let current: string;
    try {
      current = await this.files.readFile(this.currentPath, "utf8");
    } catch (readError) {
      if (!isErrno(readError, "ENOENT")) {
        throw new StateRepositoryError(`Cannot read ${this.currentPath}.`, {
          cause: readError,
        });
      }
      try {
        const previous = await this.files.readFile(this.previousPath, "utf8");
        return {
          state: parseState(previous, this.previousPath),
          recoveredFromPrevious: true,
        };
      } catch (previousError) {
        if (isErrno(previousError, "ENOENT")) {
          return {
            state: { roots: [], projects: [], activity: [] },
            recoveredFromPrevious: false,
          };
        }
        throw previousError;
      }
    }

    try {
      return {
        state: parseState(current, this.currentPath),
        recoveredFromPrevious: false,
      };
    } catch (currentError) {
      let previous: AppState;
      try {
        previous = parseState(
          await this.files.readFile(this.previousPath, "utf8"),
          this.previousPath,
        );
      } catch (previousError) {
        if (
          !(isErrno(previousError, "ENOENT") ||
            previousError instanceof StateRepositoryError)
        ) {
          throw new StateRepositoryError(
            `Current state is invalid and the previous generation could not be read: ${currentError instanceof Error ? currentError.message : "invalid state"}`,
            { cause: previousError },
          );
        }
        const quarantined = [
          await this.quarantine(this.currentPath, "current"),
        ];
        if (previousError instanceof StateRepositoryError) {
          quarantined.push(
            await this.quarantine(this.previousPath, "previous"),
          );
        }
        return this.emptyStateAfterQuarantine(quarantined);
      }
      await this.quarantine(this.currentPath, "current");
      return { state: previous, recoveredFromPrevious: true };
    }
  }

  async loadPrevious(): Promise<AppState | null> {
    try {
      return parseState(
        await this.files.readFile(this.previousPath, "utf8"),
        this.previousPath,
      );
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return null;
      }
      throw error;
    }
  }

  async save(state: AppState): Promise<void> {
    validateAppState(state);
    await this.files.mkdir(this.rootDir, { recursive: true });
    await this.files.rm(this.temporaryPath, { force: true }).catch(() => {});
    await this.files
      .rm(this.previousTemporaryPath, { force: true })
      .catch(() => {});
    try {
      await this.files.writeFile(
        this.temporaryPath,
        JSON.stringify(state, null, 2),
        {
          flush: true,
        },
      );
      try {
        const current = await this.files.readFile(this.currentPath, "utf8");
        parseState(current, this.currentPath);
        await this.files.writeFile(this.previousTemporaryPath, current, {
          flush: true,
        });
        await this.files.rename(this.previousTemporaryPath, this.previousPath);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) {
          throw error;
        }
      }
      await this.files.rename(this.temporaryPath, this.currentPath);
    } catch (error) {
      await this.files.rm(this.temporaryPath, { force: true }).catch(() => {});
      await this.files
        .rm(this.previousTemporaryPath, { force: true })
        .catch(() => {});
      if (isErrno(error, "ENOSPC")) {
        throw new StateRepositoryError(
          "Disk is full — cannot save project state. Free up space and try again.",
          { cause: error },
        );
      }
      throw error;
    }
  }
}
