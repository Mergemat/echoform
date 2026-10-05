import type { ReactNode } from "react";
import { abletonColor } from "@/lib/ableton-colors";
import { displayTrackName } from "@/lib/track-name";
import type {
  ClipAnalysis,
  SaveAnalysis,
  SetChange,
  TrackAnalysis,
  TrackChange,
} from "@/lib/types";
import { cn } from "@/lib/utils";

function bars(start: number, end: number, perBar: number): string {
  const first = Math.floor(start / perBar) + 1;
  const last = Math.max(first, Math.ceil(end / perBar));
  return first === last ? `bar ${first}` : `bars ${first}–${last}`;
}

function db(value: number): string {
  if (!Number.isFinite(value)) {
    return "−∞";
  }
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}`;
}

function pan(value: number): string {
  const amount = Math.round(Math.abs(value) * 50);
  if (amount === 0) {
    return "C";
  }
  return `${amount}${value < 0 ? "L" : "R"}`;
}

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

const Value = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[11.5px] text-foreground">{children}</span>
);

const Arrow = () => <span className="px-1 text-subtle-foreground">→</span>;

interface Line {
  key: string;
  quiet?: boolean;
  text: ReactNode;
  tone?: "added" | "removed" | "edited";
}

function clipLines(track: TrackAnalysis, perBar: number): Line[] {
  const lines: Line[] = [];
  const by = (status: ClipAnalysis["status"]) =>
    track.clips.filter((c) => c.status === status);
  const span = (clips: ClipAnalysis[]) =>
    bars(
      Math.min(...clips.map((c) => c.start)),
      Math.max(...clips.map((c) => c.end)),
      perBar
    );

  const added = by("added");
  if (added.length > 0 && track.status !== "added") {
    const notes = added.reduce(
      (sum, c) => sum + (c.notes?.added.length ?? 0),
      0
    );
    lines.push({
      key: "added",
      text: (
        <>
          {added.length === 1 ? "New clip" : `${added.length} new clips`} in{" "}
          {span(added)}
          {notes > 0 && (
            <span className="text-subtle-foreground"> · {notes} notes</span>
          )}
        </>
      ),
      tone: "added",
    });
  }
  const edited = by("edited");
  if (edited.length > 0) {
    const plus = edited.reduce(
      (sum, c) => sum + (c.notes?.added.length ?? 0),
      0
    );
    const minus = edited.reduce(
      (sum, c) => sum + (c.notes?.removed.length ?? 0),
      0
    );
    lines.push({
      key: "edited",
      text: (
        <>
          {edited.some((c) => c.kind === "midi")
            ? "Notes edited"
            : "Clips edited"}{" "}
          in {span(edited)}
          {plus + minus > 0 && (
            <span className="font-mono text-[11.5px]">
              {" "}
              <span className="text-added">+{plus}</span>{" "}
              <span className="text-removed">−{minus}</span>
            </span>
          )}
        </>
      ),
      tone: "edited",
    });
  }
  const removed = by("removed");
  if (removed.length > 0 && track.status !== "removed") {
    lines.push({
      key: "removed",
      text: <>Cleared {span(removed)}</>,
      tone: "removed",
    });
  }
  const moved = by("moved");
  if (moved.length > 0) {
    const first = moved[0]!;
    lines.push({
      key: "moved",
      text:
        moved.length === 1 && first.movedFrom !== null ? (
          bars(first.movedFrom, first.movedFrom + 1, perBar) ===
          bars(first.start, first.start + 1, perBar) ? (
            <>Clip nudged within {bars(first.start, first.start + 1, perBar)}</>
          ) : (
            <>
              Clip moved from{" "}
              {bars(first.movedFrom, first.movedFrom + 1, perBar)} to{" "}
              {bars(first.start, first.start + 1, perBar)}
            </>
          )
        ) : (
          <>{moved.length} clips moved</>
        ),
    });
  }
  const samples = [...new Set(added.map((c) => c.sample).filter(Boolean))];
  if (samples.length > 0) {
    lines.push({
      key: "samples",
      quiet: true,
      text: <>Audio: {samples.slice(0, 3).join(", ")}</>,
    });
  }
  return lines;
}

function changeLine(change: TrackChange, index: number): Line {
  const key = `${change.type}-${index}`;
  switch (change.type) {
    case "renamed":
      return { key, text: <>Renamed from “{change.from}”</> };
    case "device-added":
      return { key, text: <>{change.device} added</>, tone: "added" };
    case "device-removed":
      return { key, text: <>{change.device} removed</>, tone: "removed" };
    case "device-on":
      return { key, text: <>{change.device} turned on</> };
    case "device-off":
      return { key, text: <>{change.device} turned off</> };
    case "device-state":
      return {
        key,
        quiet: true,
        text: <>{change.device}: plugin state changed (details not readable)</>,
      };
    case "device-settings":
      return {
        key,
        text:
          change.params.length === 0 ? (
            <>{change.device} settings changed</>
          ) : (
            <>
              {change.device}
              {change.params.slice(0, 4).map((p) => (
                <span className="block pl-3 text-muted-foreground" key={p.name}>
                  {p.name} <Value>{number(p.from)}</Value>
                  <Arrow />
                  <Value>{number(p.to)}</Value>
                </span>
              ))}
              {change.params.length > 4 && (
                <span className="block pl-3 text-subtle-foreground">
                  +{change.params.length - 4} more parameters
                </span>
              )}
            </>
          ),
      };
    case "volume":
      return {
        key,
        text: (
          <>
            Volume <Value>{db(change.from)}</Value>
            <Arrow />
            <Value>{db(change.to)} dB</Value>
          </>
        ),
      };
    case "pan":
      return {
        key,
        text: (
          <>
            Pan <Value>{pan(change.from)}</Value>
            <Arrow />
            <Value>{pan(change.to)}</Value>
          </>
        ),
      };
    case "send":
      return {
        key,
        text: (
          <>
            Send {String.fromCharCode(65 + change.index)}{" "}
            <Value>{db(change.from)}</Value>
            <Arrow />
            <Value>{db(change.to)} dB</Value>
          </>
        ),
      };
    case "muted":
    case "unmuted":
    case "soloed":
    case "unsoloed":
      return {
        key,
        text: change.type.charAt(0).toUpperCase() + change.type.slice(1),
      };
    case "automation":
      return {
        key,
        text: (
          <>
            {change.target} automation {change.status}
          </>
        ),
        tone:
          change.status === "added"
            ? "added"
            : change.status === "removed"
              ? "removed"
              : undefined,
      };
    case "session-clips":
      return {
        key,
        quiet: true,
        text: (
          <>
            Session clips <Value>{change.from}</Value>
            <Arrow />
            <Value>{change.to}</Value>
          </>
        ),
      };
  }
}

function setLine(change: SetChange, index: number, perBar: number): Line {
  const key = `set-${index}`;
  switch (change.type) {
    case "tempo":
      return {
        key,
        text: (
          <>
            Tempo <Value>{change.from}</Value>
            <Arrow />
            <Value>{change.to} BPM</Value>
          </>
        ),
      };
    case "time-signature":
      return {
        key,
        text: (
          <>
            Time signature <Value>{change.from}</Value>
            <Arrow />
            <Value>{change.to}</Value>
          </>
        ),
      };
    case "locator-added":
    case "locator-removed":
      return {
        key,
        text: (
          <>
            Marker “{change.name || "untitled"}” at{" "}
            {bars(change.time, change.time + 1, perBar)}{" "}
            {change.type === "locator-added" ? "added" : "removed"}
          </>
        ),
        tone: change.type === "locator-added" ? "added" : "removed",
      };
  }
}

const TONE_MARK: Record<NonNullable<Line["tone"]>, string> = {
  added: "bg-added",
  edited: "bg-edited",
  removed: "bg-removed",
};

function Lines({ lines }: { lines: Line[] }) {
  return (
    <ul className="space-y-1">
      {lines.map((line) => (
        <li
          className={cn(
            "flex gap-2 text-[12.5px] leading-snug",
            line.quiet ? "text-subtle-foreground" : "text-muted-foreground"
          )}
          key={line.key}
        >
          <span
            aria-hidden
            className={cn(
              "mt-[7px] size-1 shrink-0 rounded-full",
              line.tone ? TONE_MARK[line.tone] : "bg-subtle-foreground"
            )}
          />
          <span className="min-w-0">{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Every change in plain words, grouped by track. */
export function ChangeList({ analysis }: { analysis: SaveAnalysis }) {
  const perBar = analysis.beatsPerBar;
  const setLines = analysis.setChanges.map((c, i) => setLine(c, i, perBar));
  const tracks = analysis.tracks
    .filter((t) => t.status !== "same")
    .map((track) => ({
      lines:
        track.status === "added"
          ? [{ key: "added", text: <>New track</>, tone: "added" as const }]
          : track.status === "removed"
            ? [
                {
                  key: "removed",
                  text: <>Track removed</>,
                  tone: "removed" as const,
                },
              ]
            : [...clipLines(track, perBar), ...track.changes.map(changeLine)],
      track,
    }))
    .filter((entry) => entry.lines.length > 0);

  if (setLines.length === 0 && tracks.length === 0) {
    return (
      <p className="text-[12.5px] text-subtle-foreground">
        {analysis.summary.first
          ? "This is the first checkpoint of this set, so there is nothing earlier to compare with."
          : "Nothing in the song changed in this save."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {setLines.length > 0 && (
        <section>
          <h4 className="mb-1.5 font-medium text-[12px] text-foreground">
            Song
          </h4>
          <Lines lines={setLines} />
        </section>
      )}
      {tracks.map(({ track, lines }) => (
        <section key={`${track.id}-${track.status}`}>
          <h4 className="mb-1.5 flex items-center gap-2 font-medium text-[12px] text-foreground">
            <span
              className="h-3 w-1 rounded-full"
              style={{ backgroundColor: abletonColor(track.color) }}
            />
            {displayTrackName(track.name)}
          </h4>
          <Lines lines={lines} />
        </section>
      ))}
    </div>
  );
}
