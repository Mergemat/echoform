/**
 * als-parser.ts – Extract a structured snapshot from an Ableton Live Set (.als) file.
 *
 * .als files are gzipped XML. We decompress, parse the XML, and pull out
 * the musically-relevant data: tracks, devices, clips, tempo, time sig.
 */

import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import type { TrackSummaryItem } from './types';

// ── Public types ────────────────────────────────────────────────────

export type SetSnapshot = {
  tempo: number;
  timeSignature: string; // e.g. "4/4"
  tracks: TrackSnapshot[];
};

export type TrackSnapshot = {
  id: string;
  type: 'audio' | 'midi' | 'return' | 'group';
  name: string;
  color: number;
  groupId: string | null; // parent GroupTrack id, or null for top-level tracks
  muted: boolean; // Speaker off = muted
  soloed: boolean;
  volume: number; // raw internal value
  pan: number;
  devices: DeviceSnapshot[];
  clipCount: number;
  clipNames: string[];
};

export type DeviceSnapshot = {
  id: string;
  className: string; // XML tag name: "Reverb", "AuPluginDevice", etc.
  name: string; // human-readable: "Pro-Q 4", "Reverb", etc.
  enabled: boolean;
};

// ── XML parser setup ────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // We need to force certain elements to always be arrays, even when
  // there's only one child.  fast-xml-parser collapses single-child
  // arrays into plain objects otherwise.
  isArray: (
    _name: string,
    _jpath: any,
    isLeafNode: boolean,
    _isAttribute: boolean,
  ) => {
    // Only force non-leaf nodes into arrays when they're known list items.
    if (isLeafNode) return false;
    const listTags = new Set([
      'MidiTrack',
      'AudioTrack',
      'ReturnTrack',
      'GroupTrack',
      'ClipSlot',
      'MidiClip',
      'AudioClip',
      'TrackSendHolder',
    ]);
    return listTags.has(_name);
  },
});

// ── Helpers ─────────────────────────────────────────────────────────

/** Safely get a property that may be an object or missing entirely. */
function val(node: any, ...path: string[]): any {
  let cur = node;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Read the Value attribute that Ableton puts everywhere: <Foo Value="123" /> */
function attrVal(node: any): string | undefined {
  if (node == null) return undefined;
  return node['@_Value'] ?? undefined;
}

/** Wrap a value that might be a single object into an array. */
function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

/** Decode Ableton's encoded time signature integer.
 *  Formula: value = (numerator - 1) + denominator_index * 99
 *  where denominator = 2 ^ denominator_index  (1, 2, 4, 8, 16, …)
 */
function decodeTimeSignature(encoded: number): string {
  const denomIndex = Math.floor(encoded / 99);
  const numerator = (encoded % 99) + 1;
  const denominator = Math.pow(2, denomIndex);
  return `${numerator}/${denominator}`;
}

// Known Ableton-native device tags → friendly names.
// Plugins (AU/VST/VST3/Max) are handled separately.
const NATIVE_DEVICE_NAMES: Record<string, string> = {
  Reverb: 'Reverb',
  Delay: 'Delay',
  Compressor2: 'Compressor',
  Eq8: 'EQ Eight',
  AutoFilter: 'Auto Filter',
  Saturator: 'Saturator',
  GlueCompressor: 'Glue Compressor',
  Chorus2: 'Chorus-Ensemble',
  Phaser: 'Phaser-Flanger',
  Redux2: 'Redux',
  Gate: 'Gate',
  Erosion: 'Erosion',
  FilterDelay: 'Filter Delay',
  GrainDelay: 'Grain Delay',
  BeatRepeat: 'Beat Repeat',
  Looper: 'Looper',
  Tuner: 'Tuner',
  Limiter: 'Limiter',
  MultibandDynamics: 'Multiband Dynamics',
  OriginalSimpler: 'Simpler',
  MultiSampler: 'Sampler',
  InstrumentGroupDevice: 'Instrument Rack',
  AudioEffectGroupDevice: 'Audio Effect Rack',
  MidiEffectGroupDevice: 'MIDI Effect Rack',
  DrumGroupDevice: 'Drum Rack',
  InstrumentVector: 'Wavetable',
  Drift: 'Drift',
  Collision: 'Collision',
  StringStudio: 'Tension',
  LoungeLizard: 'Electric',
  UltraAnalog: 'Analog',
  Operator: 'Operator',
  MxDeviceAudioEffect: 'Max Audio Effect',
  MxDeviceInstrument: 'Max Instrument',
  MxDeviceMidiEffect: 'Max MIDI Effect',
  ProxyAudioEffectDevice: 'Audio Effect Rack',
  ProxyInstrumentDevice: 'Instrument Rack',
  Amp: 'Amp',
  Cabinet: 'Cabinet',
  Corpus: 'Corpus',
  Resonators: 'Resonators',
  Vocoder: 'Vocoder',
  FrequencyShifter: 'Frequency Shifter',
  PingPongDelay: 'Ping Pong Delay',
  SimpleDelay: 'Simple Delay',
  StereoGain: 'Utility',
  Vinyl: 'Vinyl Distortion',
  Overdrive: 'Overdrive',
  Pedal: 'Pedal',
  Echo: 'Echo',
  SpectrumAnalyzer: 'Spectrum',
  CrossDelay: 'Hybrid Reverb', // Live 12
};

// Tags that represent plugin wrappers
const PLUGIN_DEVICE_TAGS = new Set([
  'AuPluginDevice',
  'VstPluginDevice',
  'Vst3PluginDevice',
]);

// Tags that should be skipped (not actual audio devices)
const SKIP_DEVICE_TAGS = new Set([
  'LomId',
  'LomIdView',
  'IsExpanded',
  'BreakoutIsExpanded',
  'On',
  'ModulationSourceCount',
  'ParametersListWrapper',
  'Pointee',
  'LastSelectedTimeableIndex',
  'LastSelectedClipEnvelopeIndex',
  'LastPresetRef',
  'LockedScripts',
  'IsFolded',
  'ShouldShowPresetName',
  'UserName',
  'Annotation',
  'SourceContext',
  'MpePitchBendUsesTuning',
  'ViewData',
]);

// ── Device extraction ───────────────────────────────────────────────

function extractPluginName(device: any, tag: string): string {
  // AU plugins
  const auInfo = val(device, 'PluginDesc', 'AuPluginInfo');
  if (auInfo) return attrVal(val(auInfo, 'Name')) ?? tag;

  // VST plugins
  const vstInfo = val(device, 'PluginDesc', 'VstPluginInfo');
  if (vstInfo) return attrVal(val(vstInfo, 'PlugName')) ?? tag;

  // VST3 plugins
  const vst3Info = val(device, 'PluginDesc', 'Vst3PluginInfo');
  if (vst3Info) return attrVal(val(vst3Info, 'Name')) ?? tag;

  return tag;
}

function extractDevices(devicesNode: any): DeviceSnapshot[] {
  if (!devicesNode || typeof devicesNode !== 'object') return [];

  const results: DeviceSnapshot[] = [];

  for (const [tag, value] of Object.entries(devicesNode)) {
    if (SKIP_DEVICE_TAGS.has(tag) || tag.startsWith('@_')) continue;

    for (const device of asArray(value) as any[]) {
      if (device == null || typeof device !== 'object') continue;

      const id = device['@_Id'] ?? '';
      const enabled = attrVal(val(device, 'On', 'Manual')) !== 'false';

      let name: string;
      if (PLUGIN_DEVICE_TAGS.has(tag)) {
        name = extractPluginName(device, tag);
      } else {
        // Native device — use user name if set, otherwise map the tag
        const userName = attrVal(val(device, 'UserName'));
        name =
          userName && userName.length > 0
            ? userName
            : (NATIVE_DEVICE_NAMES[tag] ?? tag);
      }

      results.push({ id: String(id), className: tag, name, enabled });
    }
  }

  return results;
}

// ── Clip extraction ─────────────────────────────────────────────────

function extractClips(mainSequencer: any): { count: number; names: string[] } {
  if (!mainSequencer) return { count: 0, names: [] };

  const names: string[] = [];

  // Session clips: ClipSlotList > ClipSlot[] > ClipSlot > Value > MidiClip/AudioClip
  const clipSlotList = val(mainSequencer, 'ClipSlotList');
  if (clipSlotList) {
    for (const slot of asArray(val(clipSlotList, 'ClipSlot'))) {
      // The inner <ClipSlot><Value> holds the actual clip
      const inner = val(slot, 'ClipSlot');
      if (!inner) continue;
      const clipValue = val(inner, 'Value');
      if (!clipValue) continue;
      for (const clipType of ['MidiClip', 'AudioClip']) {
        for (const clip of asArray(clipValue[clipType])) {
          const name = attrVal(val(clip, 'Name')) || '(unnamed clip)';
          names.push(name);
        }
      }
    }
  }

  // Arrangement clips: ClipTimeable > ArrangerAutomation > Events > MidiClip/AudioClip
  const events = val(
    mainSequencer,
    'ClipTimeable',
    'ArrangerAutomation',
    'Events',
  );
  if (events) {
    for (const clipType of ['MidiClip', 'AudioClip']) {
      for (const clip of asArray(events[clipType])) {
        const name = attrVal(val(clip, 'Name')) || '(unnamed clip)';
        names.push(name);
      }
    }
  }

  return { count: names.length, names };
}

// ── Track extraction ────────────────────────────────────────────────

const TRACK_TYPE_MAP: Record<string, TrackSnapshot['type']> = {
  MidiTrack: 'midi',
  AudioTrack: 'audio',
  ReturnTrack: 'return',
  GroupTrack: 'group',
};

function extractTrack(
  trackNode: any,
  trackType: TrackSnapshot['type'],
): TrackSnapshot {
  const id = String(trackNode['@_Id'] ?? '');
  const name = attrVal(val(trackNode, 'Name', 'EffectiveName')) ?? '(unnamed)';
  const color = Number(attrVal(val(trackNode, 'Color')) ?? -1);
  const rawGroupId = Number(attrVal(val(trackNode, 'TrackGroupId')) ?? -1);
  const groupId = rawGroupId >= 0 ? String(rawGroupId) : null;

  // Mixer
  const mixer = val(trackNode, 'DeviceChain', 'Mixer');
  const volume = Number(attrVal(val(mixer, 'Volume', 'Manual')) ?? 0);
  const pan = Number(attrVal(val(mixer, 'Pan', 'Manual')) ?? 0);
  const speakerOn = attrVal(val(mixer, 'Speaker', 'Manual'));
  const muted = speakerOn === 'false';
  const soloed = attrVal(val(mixer, 'SoloSink')) === 'true';

  // Devices — in some XML layouts there's an extra DeviceChain nesting
  let devicesNode = val(trackNode, 'DeviceChain', 'DeviceChain', 'Devices');
  if (!devicesNode) devicesNode = val(trackNode, 'DeviceChain', 'Devices');
  const devices = extractDevices(devicesNode);

  // Clips
  const mainSeq = val(trackNode, 'DeviceChain', 'MainSequencer');
  const { count: clipCount, names: clipNames } = extractClips(mainSeq);

  return {
    id,
    type: trackType,
    name,
    color,
    groupId,
    muted,
    soloed,
    volume,
    pan,
    devices,
    clipCount,
    clipNames,
  };
}

// ── Track summary extraction ────────────────────────────────────────

/**
 * Extract a lightweight track summary from a SetSnapshot for visual thumbnails.
 *
 * Groups are represented as a single block whose width = sum of children's
 * clip counts and whose color = the group track's color. Child tracks with a
 * color *different* from their parent group are emitted as additional blocks
 * immediately after the group block so their distinct color is visible.
 *
 * Top-level leaf tracks (not inside any group) are emitted as-is.
 */
export function extractTrackSummary(snapshot: SetSnapshot): TrackSummaryItem[] {
  // Gather children per group (preserve original track order)
  const childrenByGroup = new Map<string, TrackSnapshot[]>();
  for (const t of snapshot.tracks) {
    if (t.groupId !== null) {
      if (!childrenByGroup.has(t.groupId)) childrenByGroup.set(t.groupId, []);
      childrenByGroup.get(t.groupId)!.push(t);
    }
  }

  const result: TrackSummaryItem[] = [];

  // Walk tracks in their natural order, emitting in document order.
  // Use a Set to skip children we already accounted for under their group.
  const emitted = new Set<string>();

  for (const t of snapshot.tracks) {
    if (emitted.has(t.id)) continue;

    if (t.type === 'group') {
      const children = childrenByGroup.get(t.id) ?? [];
      const totalClips = children.reduce((s, c) => s + c.clipCount, 0);

      // Emit one block for the whole group
      result.push({
        name: t.name,
        type: 'group',
        color: t.color,
        clipCount: Math.max(1, totalClips),
      });
      emitted.add(t.id);

      // Emit child blocks only when their color differs from the group's color
      for (const child of children) {
        if (child.color !== t.color) {
          result.push({
            name: child.name,
            type: child.type,
            color: child.color,
            clipCount: Math.max(1, child.clipCount),
          });
        }
        emitted.add(child.id);
      }
    } else if (t.groupId === null) {
      // Top-level leaf track not inside any group
      result.push({
        name: t.name,
        type: t.type,
        color: t.color,
        clipCount: t.clipCount,
      });
      emitted.add(t.id);
    }
    // Tracks with groupId that aren't emitted yet are handled when their group is processed;
    // if their group wasn't found (shouldn't happen) they'll be skipped.
  }

  return result;
}

// ── Main parser ─────────────────────────────────────────────────────

export async function parseAlsFile(filePath: string): Promise<SetSnapshot> {
  const compressed = await readFile(filePath);
  let xml: string;
  try {
    xml = gunzipSync(compressed).toString('utf-8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    throw new Error(
      `Corrupt or invalid .als file — failed to decompress: ${detail}`,
    );
  }
  const doc = parser.parse(xml);

  const liveSet = val(doc, 'Ableton', 'LiveSet');
  if (!liveSet) throw new Error('Invalid .als file: no LiveSet element found.');

  // ── Tracks ──────────────────────────────────────────────────────
  const tracksNode = val(liveSet, 'Tracks');
  const tracks: TrackSnapshot[] = [];

  if (tracksNode) {
    for (const [tag, type] of Object.entries(TRACK_TYPE_MAP)) {
      for (const trackNode of asArray(tracksNode[tag])) {
        tracks.push(extractTrack(trackNode, type));
      }
    }
  }

  // ── Tempo & Time Signature (from MainTrack) ─────────────────────
  const mainTrack = val(liveSet, 'MainTrack');
  const mainMixer = val(mainTrack, 'DeviceChain', 'Mixer');
  const tempo = Number(attrVal(val(mainMixer, 'Tempo', 'Manual')) ?? 120);
  const tsEncoded = Number(
    attrVal(val(mainMixer, 'TimeSignature', 'Manual')) ?? 201,
  );
  const timeSignature = decodeTimeSignature(tsEncoded);

  return { tempo, timeSignature, tracks };
}
