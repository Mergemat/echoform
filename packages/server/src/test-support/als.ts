/** Build minimal Live 12-shaped .als files for tests. */

import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

export interface FixtureNote {
  duration?: number;
  key: number;
  time: number;
}

export interface FixtureClip {
  end: number;
  /** Clip-internal loop end; defaults to the clip's length in beats. */
  loopEnd?: number;
  name?: string;
  notes?: FixtureNote[];
  sample?: string;
  start: number;
}

export interface FixtureDevice {
  enabled?: boolean;
  id: string;
  params?: Record<string, number>;
  tag: string;
}

export interface FixtureTrack {
  clips?: FixtureClip[];
  color?: number;
  devices?: FixtureDevice[];
  groupId?: string;
  id: string;
  name: string;
  type: "audio" | "midi" | "group" | "return";
  volume?: number; // linear gain, 1 = 0 dB
}

export interface FixtureSet {
  locators?: { name: string; time: number }[];
  tempo?: number;
  tracks: FixtureTrack[];
}

const TAGS = {
  audio: "AudioTrack",
  group: "GroupTrack",
  midi: "MidiTrack",
  return: "ReturnTrack",
} as const;

function clipXml(clip: FixtureClip, kind: "midi" | "audio", id: number): string {
  const tag = kind === "midi" ? "MidiClip" : "AudioClip";
  const notes = (clip.notes ?? [])
    .map(
      (n, i) => `<KeyTrack Id="${i}"><Notes><MidiNoteEvent Time="${n.time}" Duration="${n.duration ?? 1}" Velocity="100" NoteId="${i}" /></Notes><MidiKey Value="${n.key}" /></KeyTrack>`,
    )
    .join("");
  const body =
    kind === "midi"
      ? `<Notes><KeyTracks>${notes}</KeyTracks></Notes>`
      : `<SampleRef><FileRef><RelativePath Value="Samples/${clip.sample ?? "loop.wav"}" /></FileRef></SampleRef><IsWarped Value="true" />`;
  return `<${tag} Id="${id}" Time="${clip.start}">
    <LomId Value="0" />
    <CurrentStart Value="${clip.start}" />
    <CurrentEnd Value="${clip.end}" />
    <Loop><LoopStart Value="0" /><LoopEnd Value="${clip.loopEnd ?? clip.end - clip.start}" /><LoopOn Value="false" /></Loop>
    <Name Value="${clip.name ?? ""}" />
    <Color Value="1" />
    <Disabled Value="false" />
    ${body}
  </${tag}>`;
}

function deviceXml(device: FixtureDevice): string {
  const params = Object.entries(device.params ?? {})
    .map(
      ([name, value], i) =>
        `<${name}><Manual Value="${value}" /><AutomationTarget Id="${9000 + i}" /></${name}>`,
    )
    .join("");
  return `<${device.tag} Id="${device.id}"><On><Manual Value="${device.enabled ?? true}" /></On>${params}</${device.tag}>`;
}

function trackXml(track: FixtureTrack): string {
  const tag = TAGS[track.type];
  const clips = (track.clips ?? [])
    .map((clip, i) => clipXml(clip, track.type === "midi" ? "midi" : "audio", i))
    .join("");
  const holder =
    track.type === "midi"
      ? `<ClipTimeable><ArrangerAutomation><Events>${clips}</Events></ArrangerAutomation></ClipTimeable>`
      : `<Sample><ArrangerAutomation><Events>${clips}</Events></ArrangerAutomation></Sample>`;
  return `<${tag} Id="${track.id}">
    <Name><EffectiveName Value="${track.name}" /></Name>
    <Color Value="${track.color ?? 0}" />
    <TrackGroupId Value="${track.groupId ?? -1}" />
    <DeviceChain>
      <Mixer>
        <Volume><Manual Value="${track.volume ?? 1}" /><AutomationTarget Id="1" /></Volume>
        <Pan><Manual Value="0" /></Pan>
        <Speaker><Manual Value="true" /></Speaker>
      </Mixer>
      <MainSequencer><ClipSlotList />${holder}</MainSequencer>
      <DeviceChain><Devices>${(track.devices ?? []).map(deviceXml).join("")}</Devices></DeviceChain>
    </DeviceChain>
  </${tag}>`;
}

export function alsXml(set: FixtureSet): string {
  const locators = (set.locators ?? [])
    .map((l, i) => `<Locator Id="${i}"><Time Value="${l.time}" /><Name Value="${l.name}" /></Locator>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" Creator="Ableton Live 12.3.2">
  <LiveSet>
    <Tracks>${set.tracks.map(trackXml).join("")}</Tracks>
    <MainTrack><DeviceChain><Mixer>
      <Tempo><Manual Value="${set.tempo ?? 120}" /></Tempo>
      <TimeSignature><Manual Value="201" /></TimeSignature>
    </Mixer></DeviceChain></MainTrack>
    <Locators><Locators>${locators}</Locators></Locators>
  </LiveSet>
</Ableton>`;
}

export async function writeAls(path: string, set: FixtureSet): Promise<void> {
  await writeFile(path, gzipSync(alsXml(set)));
}
