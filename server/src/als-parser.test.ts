import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { SetSnapshot, TrackSnapshot } from "./als-parser";
import { extractTrackSummary, parseAlsFile } from "./als-parser";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

function makeTrack(
  id: string,
  type: TrackSnapshot["type"],
  name: string,
  fields: Partial<TrackSnapshot> = {}
): TrackSnapshot {
  return {
    id,
    type,
    name,
    color: 0,
    groupId: null,
    muted: false,
    soloed: false,
    volume: 0.85,
    pan: 0,
    devices: [],
    clipCount: 0,
    clipNames: [],
    ...fields,
  };
}

async function writeAlsFile(xml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "echoform-als-parser-"));
  tempDirs.push(dir);
  const filePath = join(dir, "test.als");
  await writeFile(filePath, gzipSync(xml));
  return filePath;
}

function trackXml(
  tag: "AudioTrack" | "MidiTrack" | "ReturnTrack" | "GroupTrack",
  id: string,
  name: string,
  groupId = -1
): string {
  return `
    <${tag} Id="${id}">
      <Name><EffectiveName Value="${name}" /></Name>
      <Color Value="0" />
      <TrackGroupId Value="${groupId}" />
      <DeviceChain>
        <Mixer>
          <Volume><Manual Value="0.85" /></Volume>
          <Pan><Manual Value="0" /></Pan>
          <Speaker><Manual Value="true" /></Speaker>
          <SoloSink Value="false" />
        </Mixer>
        <MainSequencer />
        <Devices />
      </DeviceChain>
    </${tag}>
  `.trim();
}

describe("extractTrackSummary", () => {
  test("aggregates nested groups and keeps orphaned tracks visible", () => {
    const snapshot: SetSnapshot = {
      tempo: 120,
      timeSignature: "4/4",
      tracks: [
        makeTrack("group-1", "group", "Drums", { clipCount: 1 }),
        makeTrack("audio-1", "audio", "Kick", {
          groupId: "group-1",
          clipCount: 2,
        }),
        makeTrack("group-2", "group", "Perc", {
          groupId: "group-1",
          clipCount: 0,
        }),
        makeTrack("midi-1", "midi", "Hat", {
          groupId: "group-2",
          clipCount: 4,
        }),
        makeTrack("return-1", "return", "Reverb", { clipCount: 1 }),
        makeTrack("audio-2", "audio", "Loose Audio", {
          groupId: "missing-group",
          clipCount: 3,
        }),
      ],
    };

    expect(extractTrackSummary(snapshot)).toEqual([
      {
        name: "Drums",
        type: "group",
        color: 0,
        clipCount: 7,
        trackCount: 4,
        children: [
          {
            name: "Kick",
            type: "audio",
            color: 0,
            clipCount: 2,
            trackCount: 1,
            children: undefined,
          },
          {
            name: "Perc",
            type: "group",
            color: 0,
            clipCount: 4,
            trackCount: 2,
            children: [
              {
                name: "Hat",
                type: "midi",
                color: 0,
                clipCount: 4,
                trackCount: 1,
                children: undefined,
              },
            ],
          },
        ],
      },
      {
        name: "Reverb",
        type: "return",
        color: 0,
        clipCount: 1,
        trackCount: 1,
        children: undefined,
      },
      {
        name: "Loose Audio",
        type: "audio",
        color: 0,
        clipCount: 3,
        trackCount: 1,
        children: undefined,
      },
    ]);
  });
});

describe("parseAlsFile", () => {
  test("preserves mixed track order from the XML", async () => {
    const xml = `
      <Ableton>
        <LiveSet>
          <Tracks>
            ${trackXml("AudioTrack", "1", "Audio First")}
            ${trackXml("GroupTrack", "2", "Band Bus")}
            ${trackXml("MidiTrack", "3", "Bass MIDI", 2)}
            ${trackXml("AudioTrack", "4", "Audio Last")}
          </Tracks>
          <MainTrack>
            <DeviceChain>
              <Mixer>
                <Tempo><Manual Value="120" /></Tempo>
                <TimeSignature><Manual Value="201" /></TimeSignature>
              </Mixer>
            </DeviceChain>
          </MainTrack>
        </LiveSet>
      </Ableton>
    `;

    const filePath = await writeAlsFile(xml);
    const snapshot = await parseAlsFile(filePath);

    expect(snapshot.tracks.map((track) => track.name)).toEqual([
      "Audio First",
      "Band Bus",
      "Bass MIDI",
      "Audio Last",
    ]);
    expect(snapshot.tracks.map((track) => track.type)).toEqual([
      "audio",
      "group",
      "midi",
      "audio",
    ]);
  });
});
