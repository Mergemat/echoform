/**
 * live-set.ts – Read an Ableton Live Set (.als) into a musician-level model.
 *
 * .als files are gzipped XML. We keep what a producer would recognise when
 * comparing two versions of a song: where clips sit in the arrangement, what
 * notes they hold, which samples they play, device chains and their settings,
 * mixer levels, automation, tempo, and locators.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";

// ── Model ───────────────────────────────────────────────────────────

export type TrackType = "audio" | "midi" | "return" | "group";

export interface LiveSet {
  liveVersion: string | null;
  locators: Locator[];
  tempo: number;
  timeSignature: string;
  tracks: Track[];
}

export interface Locator {
  name: string;
  time: number; // beats
}

export interface Track {
  automation: Automation[];
  clips: Clip[];
  color: number;
  devices: Device[];
  groupId: string | null;
  id: string;
  mixer: Mixer;
  name: string;
  sessionClipCount: number;
  type: TrackType;
}

export interface Mixer {
  muted: boolean;
  pan: number; // -1..1
  sends: number[]; // dB, one per return track
  soloed: boolean;
  volumeDb: number;
}

export interface Clip {
  /** Hash of the clip's musical content, independent of where it sits. */
  contentHash: string;
  color: number;
  disabled: boolean;
  end: number; // beats, arrangement position
  kind: "midi" | "audio";
  name: string;
  notes: Note[]; // MIDI only, times relative to clip start
  sample: string | null; // audio only, file name
  start: number; // beats, arrangement position
}

export interface Note {
  duration: number;
  key: number;
  time: number;
  velocity: number;
}

export interface Device {
  className: string;
  enabled: boolean;
  id: string;
  name: string;
  params: Record<string, number>;
  /** Opaque plugin state (preset blobs). Some plugins rewrite it on every save. */
  pluginStateHash: string | null;
  /** Hash of the device's readable settings. */
  stateHash: string;
}

export interface Automation {
  hash: string;
  pointCount: number;
  target: string; // "Volume", "Pad › Echo › Feedback", …
}

// ── XML access ──────────────────────────────────────────────────────

/** Every element becomes an array so lookups never depend on child count. */
const xml = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  isArray: (_name, _jpath, _isLeaf, isAttribute) => !isAttribute,
  parseAttributeValue: false,
  parseTagValue: false,
});

type Node = Record<string, unknown>;

function children(node: Node | undefined, tag: string): Node[] {
  const value = node?.[tag];
  return Array.isArray(value) ? (value as Node[]) : [];
}

function child(node: Node | undefined, ...path: string[]): Node | undefined {
  let current = node;
  for (const tag of path) {
    current = children(current, tag)[0];
    if (!current) {
      return;
    }
  }
  return current;
}

function attr(node: Node | undefined, name: string): string | undefined {
  const value = node?.[`@_${name}`];
  return typeof value === "string" ? value : undefined;
}

function value(node: Node | undefined, ...path: string[]): string | undefined {
  return attr(child(node, ...path), "Value");
}

function num(raw: string | undefined, fallback = 0): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function elementTags(node: Node): string[] {
  return Object.keys(node).filter((key) => !key.startsWith("@_"));
}

/**
 * Keys that change with UI state or Live's internal bookkeeping, not with the
 * music. Live renumbers object ids on every save, so ids never count.
 */
const VOLATILE_TAGS = new Set([
  "@_Id",
  "AnchorTime",
  "BreakoutIsExpanded",
  "Grid",
  "IsExpanded",
  "IsFolded",
  "LastModDate",
  "LastPresetRef",
  "LastSelectedClipEnvelopeIndex",
  "LastSelectedTimeableIndex",
  "LomId",
  "LomIdView",
  "ModulationSourceCount",
  "Pointee",
  "ScrollerTimePreserver",
  "SelectedEnvelope",
  "ShouldShowPresetName",
  "SourceContext",
  "TimeSelection",
  "ViewData",
  "ViewStateExtended",
]);

function stableHash(node: Node, skip: ReadonlySet<string> = new Set()): string {
  const hash = createHash("sha1");
  const visit = (current: Node) => {
    for (const key of Object.keys(current).sort()) {
      if (VOLATILE_TAGS.has(key) || skip.has(key)) {
        continue;
      }
      const entry = current[key];
      if (Array.isArray(entry)) {
        hash.update(`<${key}>`);
        for (const item of entry) {
          if (item && typeof item === "object") {
            visit(item as Node);
          } else {
            hash.update(String(item));
          }
        }
        hash.update(`</${key}>`);
      } else {
        hash.update(`${key}=${String(entry)};`);
      }
    }
  };
  visit(node);
  return hash.digest("hex").slice(0, 16);
}

// ── Devices ─────────────────────────────────────────────────────────

const NATIVE_DEVICE_NAMES: Record<string, string> = {
  Amp: "Amp",
  AudioEffectGroupDevice: "Audio Effect Rack",
  AutoFilter: "Auto Filter",
  AutoFilter2: "Auto Filter",
  AutoPan: "Auto Pan",
  BeatRepeat: "Beat Repeat",
  Cabinet: "Cabinet",
  Chorus2: "Chorus-Ensemble",
  Collision: "Collision",
  Compressor2: "Compressor",
  Corpus: "Corpus",
  CrossDelay: "Hybrid Reverb",
  Delay: "Delay",
  Drift: "Drift",
  DrumGroupDevice: "Drum Rack",
  Echo: "Echo",
  Eq8: "EQ Eight",
  Erosion: "Erosion",
  FilterDelay: "Filter Delay",
  FrequencyShifter: "Frequency Shifter",
  Gate: "Gate",
  GlueCompressor: "Glue Compressor",
  GrainDelay: "Grain Delay",
  InstrumentGroupDevice: "Instrument Rack",
  InstrumentVector: "Wavetable",
  Limiter: "Limiter",
  Looper: "Looper",
  LoungeLizard: "Electric",
  MidiArpeggiator: "Arpeggiator",
  MidiChord: "Chord",
  MidiEffectGroupDevice: "MIDI Effect Rack",
  MidiNoteLength: "Note Length",
  MidiPitcher: "Pitch",
  MidiRandom: "Random",
  MidiScale: "Scale",
  MidiVelocity: "Velocity",
  MultiSampler: "Sampler",
  MultibandDynamics: "Multiband Dynamics",
  MxDeviceAudioEffect: "Max Audio Effect",
  MxDeviceInstrument: "Max Instrument",
  MxDeviceMidiEffect: "Max MIDI Effect",
  Operator: "Operator",
  OriginalSimpler: "Simpler",
  Overdrive: "Overdrive",
  Pedal: "Pedal",
  Phaser: "Phaser-Flanger",
  PhaserNew: "Phaser-Flanger",
  PingPongDelay: "Ping Pong Delay",
  Redux2: "Redux",
  Resonators: "Resonators",
  Reverb: "Reverb",
  Roar: "Roar",
  Saturator: "Saturator",
  SimpleDelay: "Simple Delay",
  SpectrumAnalyzer: "Spectrum",
  StereoGain: "Utility",
  StringStudio: "Tension",
  Tuner: "Tuner",
  UltraAnalog: "Analog",
  Vinyl: "Vinyl Distortion",
  Vocoder: "Vocoder",
};

const PLUGIN_TAGS = new Set([
  "AuPluginDevice",
  "PluginDevice",
  "VstPluginDevice",
  "Vst3PluginDevice",
]);

const PLUGIN_BLOB_TAGS = new Set(["Buffer", "ControllerState", "ProcessorState"]);

function blobHash(device: Node): string {
  const hash = createHash("sha1");
  const visit = (node: Node) => {
    for (const tag of elementTags(node)) {
      for (const item of children(node, tag)) {
        if (PLUGIN_BLOB_TAGS.has(tag)) {
          hash.update(String(item["#text"] ?? ""));
        } else if (item && typeof item === "object") {
          visit(item);
        }
      }
    }
  };
  visit(device);
  return hash.digest("hex").slice(0, 16);
}

/** "FilterFreq" → "Filter Freq", "Eq8 Gain" stays readable. */
function humanize(tag: string): string {
  return tag
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}

function pluginName(device: Node, tag: string): string {
  const desc = child(device, "PluginDesc");
  return (
    value(desc, "Vst3PluginInfo", "Name") ??
    value(desc, "VstPluginInfo", "PlugName") ??
    value(desc, "AuPluginInfo", "Name") ??
    tag
  );
}

/** Numeric parameters a producer can see on the device face. */
function deviceParams(device: Node, isPlugin: boolean): Record<string, number> {
  const params: Record<string, number> = {};
  if (isPlugin) {
    for (const holder of children(child(device, "ParameterList"), "PluginFloatParameter")) {
      const name = value(holder, "ParameterName");
      const manual = value(holder, "ParameterValue", "Manual");
      if (name && manual !== undefined) {
        params[name] = num(manual);
      }
    }
    return params;
  }
  for (const tag of elementTags(device)) {
    if (VOLATILE_TAGS.has(tag) || tag === "On") {
      continue;
    }
    for (const holder of children(device, tag)) {
      const manual = value(holder, "Manual");
      if (manual === undefined || !child(holder, "AutomationTarget")) {
        continue;
      }
      params[humanize(tag)] =
        manual === "true" ? 1 : manual === "false" ? 0 : num(manual);
    }
  }
  return params;
}

function readDevices(
  devicesNode: Node | undefined,
  targets: Map<string, string>,
): Device[] {
  if (!devicesNode) {
    return [];
  }
  const devices: Device[] = [];
  for (const tag of elementTags(devicesNode)) {
    for (const device of children(devicesNode, tag)) {
      const isPlugin = PLUGIN_TAGS.has(tag);
      const userName = value(device, "UserName");
      const name = isPlugin
        ? pluginName(device, tag)
        : userName || NATIVE_DEVICE_NAMES[tag] || humanize(tag);
      collectTargets(device, targets, name);
      devices.push({
        className: tag,
        enabled: value(device, "On", "Manual") !== "false",
        id: attr(device, "Id") ?? `${tag}-${devices.length}`,
        name,
        params: deviceParams(device, isPlugin),
        pluginStateHash: isPlugin ? blobHash(device) : null,
        stateHash: stableHash(device, PLUGIN_BLOB_TAGS),
      });
    }
  }
  return devices;
}

/** Map AutomationTarget ids to readable parameter paths for automation lanes. */
function collectTargets(node: Node, targets: Map<string, string>, prefix: string) {
  for (const tag of elementTags(node)) {
    for (const item of children(node, tag)) {
      const target = child(item, "AutomationTarget");
      const id = attr(target, "Id");
      if (id) {
        const label = value(item, "ParameterName") ?? humanize(tag);
        targets.set(id, prefix ? `${prefix} › ${label}` : label);
      }
      if (tag !== "AutomationTarget") {
        collectTargets(item, targets, prefix);
      }
    }
  }
}

// ── Mixer ───────────────────────────────────────────────────────────

/** Live stores fader gain as linear amplitude: 1 = 0 dB. */
export function gainToDb(gain: number): number {
  if (gain <= 0.000_316_3) {
    return Number.NEGATIVE_INFINITY;
  }
  return Math.round(20 * Math.log10(gain) * 10) / 10;
}

function readMixer(mixer: Node | undefined): Mixer {
  return {
    muted: value(mixer, "Speaker", "Manual") === "false",
    pan: num(value(mixer, "Pan", "Manual")),
    sends: children(child(mixer, "Sends"), "TrackSendHolder").map((holder) =>
      gainToDb(num(value(holder, "Send", "Manual"))),
    ),
    soloed: value(mixer, "SoloSink") === "true",
    volumeDb: gainToDb(num(value(mixer, "Volume", "Manual"), 1)),
  };
}

// ── Clips ───────────────────────────────────────────────────────────

function readNotes(clip: Node): Note[] {
  const notes: Note[] = [];
  for (const keyTrack of children(child(clip, "Notes", "KeyTracks"), "KeyTrack")) {
    const key = num(value(keyTrack, "MidiKey"));
    for (const event of children(child(keyTrack, "Notes"), "MidiNoteEvent")) {
      if (attr(event, "IsEnabled") === "false") {
        continue;
      }
      notes.push({
        duration: num(attr(event, "Duration")),
        key,
        time: num(attr(event, "Time")),
        velocity: num(attr(event, "Velocity"), 100),
      });
    }
  }
  return notes.sort((a, b) => a.time - b.time || a.key - b.key);
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

const round = (raw: string | undefined) => num(raw).toFixed(3);

/**
 * What the clip plays, independent of where it sits. Built from musical fields
 * only: Live re-derives warp-marker timings and clip ends whenever the tempo
 * changes, and that bookkeeping must not read as an edit.
 */
function clipContentHash(clip: Node, notes: Note[], sample: string | null): string {
  const loop = child(clip, "Loop");
  const fades = child(clip, "Fades");
  const envelopes = child(clip, "Envelopes");
  const parts = [
    value(clip, "Name"),
    value(clip, "Disabled"),
    round(value(loop, "LoopStart")),
    round(value(loop, "LoopEnd")),
    round(value(loop, "StartRelative")),
    value(loop, "LoopOn"),
    envelopes ? stableHash(envelopes) : "",
    sample,
    value(clip, "IsWarped"),
    value(clip, "WarpMode"),
    value(clip, "PitchCoarse"),
    round(value(clip, "PitchFine")),
    round(value(clip, "SampleVolume")),
    round(value(fades, "FadeInLength")),
    round(value(fades, "FadeOutLength")),
    notes
      .map((n) => `${n.key}:${n.time.toFixed(3)}:${n.duration.toFixed(3)}:${n.velocity}`)
      .join(","),
  ];
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

function readClip(clip: Node, kind: Clip["kind"]): Clip {
  const fileRef = child(clip, "SampleRef", "FileRef");
  const samplePath = value(fileRef, "RelativePath") || value(fileRef, "Path");
  const sample = samplePath ? fileName(samplePath) : null;
  const notes = kind === "midi" ? readNotes(clip) : [];
  const start = num(value(clip, "CurrentStart"), num(attr(clip, "Time")));
  return {
    contentHash: clipContentHash(clip, notes, sample),
    color: num(value(clip, "Color"), -1),
    disabled: value(clip, "Disabled") === "true",
    end: num(value(clip, "CurrentEnd"), start),
    kind,
    name: value(clip, "Name") ?? "",
    notes,
    sample,
    start,
  };
}

function readArrangementClips(sequencer: Node | undefined): Clip[] {
  const clips: Clip[] = [];
  // MIDI tracks keep arrangement clips under ClipTimeable, audio tracks under Sample.
  for (const holder of ["ClipTimeable", "Sample"]) {
    const events = child(sequencer, holder, "ArrangerAutomation", "Events");
    for (const clip of children(events, "MidiClip")) {
      clips.push(readClip(clip, "midi"));
    }
    for (const clip of children(events, "AudioClip")) {
      clips.push(readClip(clip, "audio"));
    }
  }
  return clips.sort((a, b) => a.start - b.start);
}

function countSessionClips(sequencer: Node | undefined): number {
  let count = 0;
  for (const slot of children(child(sequencer, "ClipSlotList"), "ClipSlot")) {
    const holder = child(slot, "ClipSlot", "Value");
    count += children(holder, "MidiClip").length + children(holder, "AudioClip").length;
  }
  return count;
}

// ── Automation ──────────────────────────────────────────────────────

function readAutomation(track: Node, targets: Map<string, string>): Automation[] {
  const lanes: Automation[] = [];
  for (const envelope of children(
    child(track, "AutomationEnvelopes", "Envelopes"),
    "AutomationEnvelope",
  )) {
    const targetId = value(envelope, "EnvelopeTarget", "PointeeId");
    const events = child(envelope, "Automation", "Events");
    if (!(targetId && events)) {
      continue;
    }
    const pointCount = elementTags(events).reduce(
      (sum, tag) => sum + children(events, tag).length,
      0,
    );
    lanes.push({
      hash: stableHash(events),
      pointCount,
      target: targets.get(targetId) ?? "Parameter",
    });
  }
  return lanes;
}

// ── Tracks ──────────────────────────────────────────────────────────

const TRACK_TYPES: Record<string, TrackType> = {
  AudioTrack: "audio",
  GroupTrack: "group",
  MidiTrack: "midi",
  ReturnTrack: "return",
};

function readTrack(node: Node, type: TrackType): Track {
  const name = value(node, "Name", "EffectiveName") ?? "Untitled";
  const groupId = num(value(node, "TrackGroupId"), -1);
  const deviceChain = child(node, "DeviceChain");
  const mixer = child(deviceChain, "Mixer");
  // Automation lanes point at parameters by id; name them "Volume" or "Echo › Feedback".
  const targets = new Map<string, string>();
  collectTargets(mixer ?? {}, targets, "");
  const devices = readDevices(
    child(deviceChain, "DeviceChain", "Devices") ?? child(deviceChain, "Devices"),
    targets,
  );
  const sequencer = child(deviceChain, "MainSequencer");

  return {
    automation: readAutomation(node, targets),
    clips: readArrangementClips(sequencer),
    color: num(value(node, "Color"), -1),
    devices,
    groupId: groupId >= 0 ? String(groupId) : null,
    id: attr(node, "Id") ?? name,
    mixer: readMixer(mixer),
    name,
    sessionClipCount: countSessionClips(sequencer),
    type,
  };
}

/** Track order matters (it's the arrangement's row order); recover it from the raw XML. */
function trackTagOrder(raw: string): string[] {
  const start = raw.indexOf("<Tracks>");
  const end = raw.indexOf("</Tracks>", start);
  if (start === -1 || end === -1) {
    return [];
  }
  const order: string[] = [];
  let depth = 0;
  const tagPattern = /<(\/?)(\w+)[^>]*?(\/?)>/g;
  tagPattern.lastIndex = start + "<Tracks>".length;
  for (let match = tagPattern.exec(raw); match && match.index < end; match = tagPattern.exec(raw)) {
    const [, closing, tag, selfClosing] = match;
    if (closing) {
      depth -= 1;
    } else if (!selfClosing) {
      if (depth === 0 && tag && TRACK_TYPES[tag]) {
        order.push(tag);
      }
      depth += 1;
    }
  }
  return order;
}

// ── Entry point ─────────────────────────────────────────────────────

export function parseLiveSetXml(raw: string): LiveSet {
  const doc = xml.parse(raw) as Node;
  const ableton = child(doc, "Ableton");
  const liveSet = child(ableton, "LiveSet");
  if (!liveSet) {
    throw new Error("Not an Ableton Live Set: no LiveSet element.");
  }

  const tracksNode = child(liveSet, "Tracks");
  const queues = new Map(
    Object.keys(TRACK_TYPES).map((tag) => [tag, [...children(tracksNode, tag)]]),
  );
  const tracks: Track[] = [];
  for (const tag of trackTagOrder(raw)) {
    const node = queues.get(tag)?.shift();
    if (node) {
      tracks.push(readTrack(node, TRACK_TYPES[tag]!));
    }
  }
  for (const [tag, rest] of queues) {
    for (const node of rest) {
      tracks.push(readTrack(node, TRACK_TYPES[tag]!));
    }
  }

  const main = child(liveSet, "MainTrack") ?? child(liveSet, "MasterTrack");
  const mainMixer = child(main, "DeviceChain", "Mixer");
  const encodedSignature = num(value(mainMixer, "TimeSignature", "Manual"), 201);

  return {
    liveVersion: attr(ableton, "Creator")?.replace(/^Ableton Live\s*/, "") ?? null,
    locators: children(child(liveSet, "Locators", "Locators"), "Locator")
      .map((locator) => ({
        name: value(locator, "Name") ?? "",
        time: num(value(locator, "Time")),
      }))
      .sort((a, b) => a.time - b.time),
    tempo: Math.round(num(value(mainMixer, "Tempo", "Manual"), 120) * 100) / 100,
    timeSignature: `${(encodedSignature % 99) + 1}/${2 ** Math.floor(encodedSignature / 99)}`,
    tracks,
  };
}

export async function readLiveSet(filePath: string): Promise<LiveSet> {
  const compressed = await readFile(filePath);
  let raw: string;
  try {
    raw = gunzipSync(compressed).toString("utf-8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Not a readable .als file (${detail}).`);
  }
  return parseLiveSetXml(raw);
}
