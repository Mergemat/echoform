import { basename, extname } from "@/lib/path";
import type { Idea, Project, Save } from "@/lib/types";

// ── Idea tree helpers ────────────────────────────────────────────────

/** Root ideas = no parent or parent doesn't exist in the project */
export function getRootIdeas(project: Project): Idea[] {
  const ids = new Set(project.ideas.map((i) => i.id));
  return project.ideas.filter(
    (i) => !(i.parentIdeaId && ids.has(i.parentIdeaId))
  );
}

/** Walk up parentIdeaId to find the root ancestor of a given idea */
export function getRootIdeaFor(project: Project, ideaId: string): Idea | null {
  const byId = new Map(project.ideas.map((i) => [i.id, i]));
  let current = byId.get(ideaId) ?? null;
  while (current?.parentIdeaId && byId.has(current.parentIdeaId)) {
    current = byId.get(current.parentIdeaId)!;
  }
  return current;
}

/** Get all idea IDs that descend from a root idea (including the root itself) */
export function getIdeaSubtreeIds(
  project: Project,
  rootIdeaId: string
): Set<string> {
  const result = new Set<string>([rootIdeaId]);
  const childrenByParent = new Map<string, Idea[]>();
  for (const idea of project.ideas) {
    if (!idea.parentIdeaId) {
      continue;
    }
    const existing = childrenByParent.get(idea.parentIdeaId) ?? [];
    existing.push(idea);
    childrenByParent.set(idea.parentIdeaId, existing);
  }
  const visit = (id: string) => {
    for (const child of childrenByParent.get(id) ?? []) {
      result.add(child.id);
      visit(child.id);
    }
  };
  visit(rootIdeaId);
  return result;
}

export interface RootFileGroup {
  representativeIdea: Idea;
  rootIdeas: Idea[];
  setPath: string;
}

export function getRootFileGroups(project: Project): RootFileGroup[] {
  const groups = new Map<string, RootFileGroup>();
  for (const idea of getRootIdeas(project)) {
    const existing = groups.get(idea.setPath);
    if (existing) {
      existing.rootIdeas.push(idea);
    } else {
      groups.set(idea.setPath, {
        setPath: idea.setPath,
        rootIdeas: [idea],
        representativeIdea: idea,
      });
    }
  }
  return [...groups.values()];
}

/** Display name for a root idea's .als file (filename without extension) */
export function fileTabName(idea: Idea): string {
  const name = basename(idea.setPath);
  const ext = extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

// ── Formatters ───────────────────────────────────────────────────────
function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}:${m}${ampm}`;
}

export function formatSizeDelta(bytes: number): string {
  const abs = Math.abs(bytes);
  const sign = bytes >= 0 ? "+" : "\u2212";
  if (abs < 1024) {
    return `${sign}${abs}B`;
  }
  if (abs < 1024 * 1024) {
    return `${sign}${(abs / 1024).toFixed(0)}K`;
  }
  return `${sign}${(abs / 1024 / 1024).toFixed(1)}M`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  const time = formatTime(iso);

  if (diffDays === 0) {
    return `Today ${time}`;
  }
  if (diffDays === 1) {
    return `Yesterday ${time}`;
  }
  if (diffDays < 7) {
    const day = d.toLocaleDateString(undefined, { weekday: "long" });
    return `${day} ${time}`;
  }
  return `${d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} ${time}`;
}

function formatSaveTitle(iso: string, options?: { compact?: boolean }): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: options?.compact ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getSaveDisplayTitle(
  save: { label: string; createdAt: string; customLabel?: boolean },
  options?: { compact?: boolean }
): string {
  if (save.customLabel && save.label.trim()) {
    return save.label.trim();
  }
  return formatSaveTitle(save.createdAt, options);
}

// ── File-type helpers ────────────────────────────────────────────────
const AUDIO_EXT = new Set([
  ".aif",
  ".aiff",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".wav",
]);

export function isAudio(p: string) {
  return AUDIO_EXT.has(extname(p).toLowerCase());
}

export function isAls(p: string) {
  return extname(p).toLowerCase() === ".als";
}

// ── Chip builders ────────────────────────────────────────────────────
export interface Chip {
  kind: "neutral" | "add" | "remove" | "change";
  label: string;
}

export function buildChips(save: Save): Chip[] {
  const chips: Chip[] = [];
  const sd = save.setDiff;
  if (sd) {
    if (sd.tempoChange) {
      chips.push({
        label: `${sd.tempoChange.from}\u2192${sd.tempoChange.to} bpm`,
        kind: "change",
      });
    }
    if (sd.timeSignatureChange) {
      chips.push({
        label: `${sd.timeSignatureChange.from}\u2192${sd.timeSignatureChange.to}`,
        kind: "change",
      });
    }
    const addByType: Record<string, number> = {};
    const remByType: Record<string, number> = {};
    for (const t of sd.addedTracks) {
      addByType[t.type] = (addByType[t.type] ?? 0) + 1;
    }
    for (const t of sd.removedTracks) {
      remByType[t.type] = (remByType[t.type] ?? 0) + 1;
    }
    const TL: Record<string, string> = {
      midi: "MIDI",
      audio: "Audio",
      return: "Return",
      group: "Group",
    };
    for (const [type, count] of Object.entries(addByType)) {
      chips.push({ label: `+${count} ${TL[type] ?? type}`, kind: "add" });
    }
    for (const [type, count] of Object.entries(remByType)) {
      chips.push({
        label: `\u2212${count} ${TL[type] ?? type}`,
        kind: "remove",
      });
    }
    const renames = sd.modifiedTracks.filter((t) => t.renamedFrom);
    if (renames.length === 1) {
      chips.push({
        label: `\u201c${renames[0]?.renamedFrom}\u201d\u2192\u201c${renames[0]?.name}\u201d`,
        kind: "change",
      });
    } else if (renames.length >= 2) {
      chips.push({ label: `${renames.length} tracks renamed`, kind: "change" });
    }
    let deviceDelta = 0;
    for (const t of sd.modifiedTracks) {
      deviceDelta += t.addedDevices.length - t.removedDevices.length;
    }
    if (deviceDelta !== 0) {
      chips.push({
        label: `${deviceDelta > 0 ? "+" : ""}${deviceDelta} device${Math.abs(deviceDelta) === 1 ? "" : "s"}`,
        kind: deviceDelta > 0 ? "add" : "remove",
      });
    }
    let clipDelta = 0;
    for (const t of sd.modifiedTracks) {
      clipDelta += t.clipCountDelta;
    }
    if (clipDelta !== 0) {
      chips.push({
        label: `${clipDelta > 0 ? "+" : ""}${clipDelta} clip${Math.abs(clipDelta) === 1 ? "" : "s"}`,
        kind: clipDelta > 0 ? "add" : "remove",
      });
    }
    if (sd.modifiedTracks.some((t) => t.mixerChanges.length > 0)) {
      chips.push({ label: "mixer changes", kind: "neutral" });
    }
  }
  if (save.changes) {
    const added = save.changes.addedFiles.filter((f) => !isAls(f));
    const removed = save.changes.removedFiles.filter((f) => !isAls(f));
    if (added.length > 0) {
      chips.push({
        label: `+${added.length} file${added.length === 1 ? "" : "s"}`,
        kind: "add",
      });
    }
    if (removed.length > 0) {
      chips.push({
        label: `\u2212${removed.length} file${removed.length === 1 ? "" : "s"}`,
        kind: "remove",
      });
    }
  }
  return chips;
}

// ── Auto-save grouping ───────────────────────────────────────────────
type DisplayItem =
  | { type: "save"; save: Save }
  | { type: "group"; saves: Save[]; key: string };

function isTrivialAutoSave(save: Save): boolean {
  if (!save.auto) {
    return false;
  }
  const sd = save.setDiff;
  if (sd) {
    if (sd.tempoChange || sd.timeSignatureChange) {
      return false;
    }
    if (
      sd.addedTracks.length ||
      sd.removedTracks.length ||
      sd.modifiedTracks.length
    ) {
      return false;
    }
  }
  if (save.changes) {
    if (save.changes.addedFiles.filter((f) => !isAls(f)).length) {
      return false;
    }
    if (save.changes.removedFiles.filter((f) => !isAls(f)).length) {
      return false;
    }
  }
  return true;
}

function buildDisplayItems(
  saves: Save[],
  expandedGroups: Set<string>,
  ungroupableSaveIds: Set<string> = new Set()
): DisplayItem[] {
  const items: DisplayItem[] = [];
  let i = 0;
  while (i < saves.length) {
    const save = saves[i]!;
    if (isTrivialAutoSave(save) && !ungroupableSaveIds.has(save.id)) {
      const group: Save[] = [save];
      let j = i + 1;
      while (
        j < saves.length &&
        isTrivialAutoSave(saves[j]!) &&
        !ungroupableSaveIds.has(saves[j]?.id)
      ) {
        group.push(saves[j]!);
        j++;
      }
      if (group.length >= 2) {
        const key = group[0]?.id;
        if (expandedGroups.has(key)) {
          for (const s of group) {
            items.push({ type: "save", save: s });
          }
        } else {
          items.push({ type: "group", saves: group, key });
        }
        i = j;
        continue;
      }
    }
    items.push({ type: "save", save });
    i++;
  }
  return items;
}

type TimelineDisplayItem =
  | {
      type: "branch";
      idea: Idea;
      depth: number;
      fromSave: Save | null;
      isCurrent: boolean;
      isFocused: boolean;
      isCollapsed: boolean;
      saveCount: number;
    }
  | {
      type: "save";
      save: Save;
      idea: Idea;
      depth: number;
      isFocused: boolean;
    }
  | {
      type: "group";
      saves: Save[];
      key: string;
      idea: Idea;
      depth: number;
      isFocused: boolean;
    };

function sortIdeasByNewestSave(
  ideas: Idea[],
  savesByIdea: Map<string, Save[]>
): Idea[] {
  return [...ideas].sort((a, b) => {
    const aNewest = savesByIdea.get(a.id)?.[0]?.createdAt ?? a.createdAt;
    const bNewest = savesByIdea.get(b.id)?.[0]?.createdAt ?? b.createdAt;
    return bNewest.localeCompare(aNewest);
  });
}

export function buildTimelineDisplayItems(
  project: Project,
  focusedIdeaId: string | null,
  expandedGroups: Set<string>,
  collapsedBranches: Set<string> = new Set()
): TimelineDisplayItem[] {
  const savesByIdea = new Map<string, Save[]>();
  for (const idea of project.ideas) {
    const saves = project.saves
      .filter((save) => save.ideaId === idea.id)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    savesByIdea.set(idea.id, saves);
  }

  const ideasById = new Map(project.ideas.map((idea) => [idea.id, idea]));
  const savesById = new Map(project.saves.map((save) => [save.id, save]));
  const childrenBySaveId = new Map<string, Idea[]>();
  for (const idea of project.ideas) {
    if (!idea.forkedFromSaveId) {
      continue;
    }
    const existing = childrenBySaveId.get(idea.forkedFromSaveId) ?? [];
    existing.push(idea);
    childrenBySaveId.set(idea.forkedFromSaveId, existing);
  }
  for (const [saveId, children] of childrenBySaveId) {
    childrenBySaveId.set(saveId, sortIdeasByNewestSave(children, savesByIdea));
  }

  const forkSaveIds = new Set(
    project.ideas
      .map((idea) => idea.forkedFromSaveId)
      .filter((id): id is string => Boolean(id))
  );
  const rootIdeas = sortIdeasByNewestSave(
    project.ideas.filter(
      (idea) => !(idea.parentIdeaId && ideasById.has(idea.parentIdeaId))
    ),
    savesByIdea
  );
  const effectiveFocusId = focusedIdeaId ?? project.currentIdeaId;
  const items: TimelineDisplayItem[] = [];

  const visitIdea = (idea: Idea, depth: number) => {
    const fromSave = idea.forkedFromSaveId
      ? (savesById.get(idea.forkedFromSaveId) ?? null)
      : null;
    const isFocused = idea.id === effectiveFocusId;
    const ideaSaves = savesByIdea.get(idea.id) ?? [];
    const isCollapsed = collapsedBranches.has(idea.id) && !isFocused;

    items.push({
      type: "branch",
      idea,
      depth,
      fromSave,
      isCurrent: idea.id === project.currentIdeaId,
      isFocused,
      isCollapsed,
      saveCount: ideaSaves.length,
    });

    if (isCollapsed) {
      return;
    }

    const branchItems = buildDisplayItems(
      ideaSaves,
      expandedGroups,
      forkSaveIds
    );

    for (const item of branchItems) {
      if (item.type === "group") {
        items.push({
          type: "group",
          saves: item.saves,
          key: item.key,
          idea,
          depth,
          isFocused,
        });
        continue;
      }

      items.push({
        type: "save",
        save: item.save,
        idea,
        depth,
        isFocused,
      });

      const children = childrenBySaveId.get(item.save.id) ?? [];
      for (const child of children) {
        visitIdea(child, depth + 1);
      }
    }
  };

  for (const idea of rootIdeas) {
    visitIdea(idea, 0);
  }
  return items;
}
