import {
  ChatText,
  GitBranch,
  Pause,
  Play,
  PushPin,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { abletonColor } from "@/lib/ableton-colors";
import { usePreviewStore } from "@/lib/preview-store";
import type { Project, Save } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatTime } from "./timeline-utils";

/** Time · spine node · text · status. Shared so rows and group rows line up. */
export const ROW_GRID =
  "grid grid-cols-[4.5rem_1.5rem_minmax(0,1fr)_auto] items-center gap-x-3";

export function describeSave(project: Project, save: Save): string {
  if (!save.auto && project.continuedFrom) {
    return "Starting point of this branch";
  }
  if (!save.summary) {
    return "Analyzing…";
  }
  return save.summary.headline;
}

/** All words a search can match for a save. */
function searchText(save: Save): string {
  const summary = save.summary;
  return [
    save.customLabel ? save.label : "",
    save.note,
    summary?.headline ?? "",
    ...(summary?.changes ?? []),
    ...(summary?.touched.map((t) => t.name) ?? []),
  ]
    .join("\n")
    .toLowerCase();
}

function words(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesSearch(save: Save, query: string): boolean {
  const haystack = searchText(save);
  return words(query).every((word) => haystack.includes(word));
}

/** When searching, show the change that matched instead of the headline. */
function lineFor(project: Project, save: Save, query: string): string {
  const wanted = words(query);
  if (wanted.length > 0) {
    const hit = save.summary?.changes.find((change) =>
      wanted.every((word) => change.toLowerCase().includes(word))
    );
    if (hit) {
      return hit;
    }
  }
  return describeSave(project, save);
}

/** Track colours from Live's palette, lifted so they read on graphite. */
function readable(index: number): string {
  return `color-mix(in srgb, ${abletonColor(index)} 78%, white)`;
}

/** Track names in the line appear in their Ableton colour. */
function TrackColoredText({ text, save }: { text: string; save: Save }) {
  const tracks = [...(save.summary?.touched ?? [])]
    .filter((t) => t.name.length > 1)
    .sort((a, b) => b.name.length - a.name.length);
  if (tracks.length === 0) {
    return <>{text}</>;
  }
  const escaped = tracks.map((t) =>
    t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  const pattern = new RegExp(`(${escaped.join("|")})`);
  for (let match = pattern.exec(rest); match; match = pattern.exec(rest)) {
    if (match.index > 0) {
      parts.push(rest.slice(0, match.index));
    }
    const track = tracks.find((t) => t.name === match![0]);
    parts.push(
      <span
        className="font-medium"
        key={key++}
        style={{ color: track ? readable(track.color) : undefined }}
      >
        {match[0]}
      </span>
    );
    rest = rest.slice(match.index + match[0].length);
  }
  parts.push(rest);
  return <>{parts}</>;
}

/** A node on the history spine: size says how much changed, colour says where. */
export function SpineNode({
  save,
  selected,
}: {
  save: Save;
  selected: boolean;
}) {
  const summary = save.summary;
  const colorIndex = summary?.regions[0]?.color ?? summary?.touched[0]?.color;
  const weight = summary?.weight;
  const size = weight === "major" ? 12 : weight === "minor" ? 8 : 6;
  const filled = weight === "major" || weight === "minor";
  const color =
    colorIndex === undefined ? "var(--muted-foreground)" : readable(colorIndex);
  return (
    <span className="relative flex h-full items-center justify-center self-stretch">
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line"
      />
      <span
        aria-hidden
        className={cn(
          "relative rounded-full transition-transform",
          selected && "scale-125"
        )}
        style={{
          backgroundColor: filled ? color : "var(--background)",
          border: `1.5px solid ${filled ? "var(--background)" : "var(--subtle-foreground)"}`,
          boxShadow: selected
            ? "0 0 0 2px var(--foreground)"
            : filled && weight === "major"
              ? `0 0 12px -2px ${color}`
              : undefined,
          height: size + 3,
          width: size + 3,
        }}
      />
    </span>
  );
}

export function CheckpointRow({
  save,
  isSelected,
  isHead,
  project,
  query = "",
  indented = false,
  onClick,
}: {
  save: Save;
  isSelected: boolean;
  isHead: boolean;
  project: Project;
  query?: string;
  indented?: boolean;
  onClick: () => void;
}) {
  const openPreviewPlayer = usePreviewStore((s) => s.openPreviewPlayer);
  const previewPlayerSaveId = usePreviewStore((s) => s.previewPlayerSaveId);
  const isBranchStart = !save.auto && Boolean(project.continuedFrom);
  const isPlaying = previewPlayerSaveId === save.id;
  const name = save.customLabel ? save.label.trim() : null;
  const hasAudio = save.previewStatus === "ready";
  // The versions people come back to: named, or with a bounce to play.
  const isMoment = Boolean(name) || hasAudio;
  const quiet = save.summary?.weight === "none";
  const line = lineFor(project, save, query);
  const more = query ? 0 : Math.max(0, (save.summary?.changes.length ?? 0) - 1);

  return (
    <div
      className={cn(
        ROW_GRID,
        "relative rounded-md pr-2 pl-3 transition-colors duration-100",
        isMoment ? "min-h-16 py-2.5" : "min-h-10",
        isSelected ? "bg-raised" : "hover:bg-raised/60"
      )}
    >
      <button
        aria-label={`Checkpoint at ${formatTime(save.createdAt)}${name ? `: ${name}` : ""}`}
        aria-pressed={isSelected}
        className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onClick}
        type="button"
      />

      <span
        className={cn(
          "pointer-events-none font-mono text-[12px] tabular-nums",
          isSelected ? "text-foreground" : "text-muted-foreground",
          indented && "text-subtle-foreground"
        )}
      >
        {formatTime(save.createdAt)}
      </span>

      <span className="pointer-events-none self-stretch">
        <SpineNode save={save} selected={isSelected} />
      </span>

      <span className="pointer-events-none min-w-0">
        {name && (
          <span className="block truncate font-semibold text-[16px] text-foreground tracking-tight">
            {name}
          </span>
        )}
        <span
          className={cn(
            "block truncate",
            name ? "text-[12.5px]" : "text-[13.5px]",
            quiet ? "text-subtle-foreground" : "text-muted-foreground",
            !quiet && isSelected && "text-foreground"
          )}
        >
          <TrackColoredText save={save} text={line} />
          {more > 0 && (
            <span className="text-subtle-foreground"> · +{more}</span>
          )}
        </span>
      </span>

      <span className="pointer-events-none flex items-center justify-end gap-2 text-subtle-foreground">
        {save.note.trim() && <ChatText aria-label="Has a note" size={13} />}
        {save.pinned && <PushPin aria-label="Pinned" size={13} weight="fill" />}
        {isBranchStart && <GitBranch aria-label="Branch start" size={13} />}
        {isHead && (
          <span className="rounded-full border border-foreground/40 px-2 font-mono text-[10px] text-foreground uppercase leading-5 tracking-wider">
            Latest
          </span>
        )}
        {hasAudio && (
          <button
            aria-label={isPlaying ? "Now playing" : "Play preview"}
            className={cn(
              "pointer-events-auto relative flex size-8 items-center justify-center rounded-full transition-colors",
              isPlaying
                ? "bg-foreground text-background"
                : "bg-secondary text-foreground hover:bg-foreground hover:text-background"
            )}
            onClick={() => openPreviewPlayer(save.id, project)}
            type="button"
          >
            {isPlaying ? (
              <Pause size={12} weight="fill" />
            ) : (
              <Play size={12} weight="fill" />
            )}
          </button>
        )}
      </span>
    </div>
  );
}
