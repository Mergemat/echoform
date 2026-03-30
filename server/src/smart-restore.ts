import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import * as cheerio from "cheerio";
import { parseAlsFile } from "./als-parser";
import type { SmartRestoreResult, SmartRestoreTrack } from "./types";

type TrackType = "audio" | "midi" | "group" | "return";

interface TopLevelTrack {
  groupId: string | null;
  hasAutomation: boolean;
  id: string;
  name: string;
  nodeXml: string;
  sendSlots: { index: number; manual: number }[];
  sourceIndex: number;
  type: TrackType;
}

const DEFAULT_SEND_VALUE = "0.0003162277571";
const DEFAULT_SEND_EPSILON = 0.000_000_1;

function loadAlsXml(xml: string) {
  return cheerio.load(xml, { xmlMode: true });
}

function tagToTrackType(tag: string): TrackType | null {
  if (tag === "AudioTrack") {
    return "audio";
  }
  if (tag === "MidiTrack") {
    return "midi";
  }
  if (tag === "GroupTrack") {
    return "group";
  }
  if (tag === "ReturnTrack") {
    return "return";
  }
  return null;
}

function directMixer($: cheerio.CheerioAPI, track: any) {
  const deviceChain = $(track).children("DeviceChain").first();
  const direct = deviceChain.children("Mixer").first();
  if (direct.length > 0) {
    return direct;
  }
  return deviceChain.children("DeviceChain").children("Mixer").first();
}

function parseTopLevelTracks(xml: string): TopLevelTrack[] {
  const $ = loadAlsXml(xml);
  return $("Ableton > LiveSet > Tracks")
    .children()
    .toArray()
    .map((node, sourceIndex) => {
      const type = tagToTrackType(node.tagName);
      if (!type) {
        return null;
      }
      const mixer = directMixer($, node);
      const sends = mixer
        .children("Sends")
        .children("TrackSendHolder")
        .toArray()
        .map((holder) => ({
          index: Number($(holder).attr("Id") ?? "-1"),
          manual: Number(
            $(holder).children("Send").children("Manual").attr("Value") ??
              DEFAULT_SEND_VALUE
          ),
        }))
        .filter((slot) => Number.isFinite(slot.index) && slot.index >= 0);

      return {
        id: $(node).attr("Id") ?? "",
        name:
          $(node).children("Name").children("EffectiveName").attr("Value") ??
          "(unnamed)",
        type,
        groupId: (() => {
          const value = $(node).children("TrackGroupId").attr("Value");
          return value && value !== "-1" ? value : null;
        })(),
        nodeXml: $.xml(node),
        sourceIndex,
        sendSlots: sends,
        hasAutomation:
          $(node).children("AutomationEnvelopes").find("Envelopes").children()
            .length > 0,
      };
    })
    .filter((track): track is TopLevelTrack => Boolean(track));
}

function buildTrackMap(tracks: TopLevelTrack[]) {
  return new Map(tracks.map((track) => [track.id, track]));
}

function isTrackDescendantOf(
  map: Map<string, TopLevelTrack>,
  track: TopLevelTrack,
  ancestorGroupId: string
): boolean {
  let groupId = track.groupId;
  while (groupId) {
    if (groupId === ancestorGroupId) {
      return true;
    }
    groupId = map.get(groupId)?.groupId ?? null;
  }
  return false;
}

function resolveRestoreClosure(
  tracks: TopLevelTrack[],
  selectedTrackIds: string[]
): Set<string> {
  const map = buildTrackMap(tracks);
  const included = new Set<string>();

  for (const id of selectedTrackIds) {
    const track = map.get(id);
    if (!track) {
      continue;
    }
    included.add(id);
    if (track.type === "group") {
      for (const candidate of tracks) {
        if (candidate.id !== id && isTrackDescendantOf(map, candidate, id)) {
          included.add(candidate.id);
        }
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...included]) {
      const track = map.get(id);
      if (!track) {
        continue;
      }
      if (track.groupId && !included.has(track.groupId)) {
        included.add(track.groupId);
        changed = true;
      }
    }
  }

  const sourceReturns = tracks.filter((track) => track.type === "return");
  const neededReturnIndices = new Set<number>();
  for (const id of included) {
    const track = map.get(id);
    if (!track || track.type === "return") {
      continue;
    }
    for (const slot of track.sendSlots) {
      if (
        slot.manual > Number(DEFAULT_SEND_VALUE) + DEFAULT_SEND_EPSILON ||
        track.hasAutomation
      ) {
        neededReturnIndices.add(slot.index);
      }
    }
  }

  for (const index of neededReturnIndices) {
    const returnTrack = sourceReturns[index];
    if (returnTrack) {
      included.add(returnTrack.id);
    }
  }

  return included;
}

export function listRestorableTracks(
  alsPath: string
): Promise<SmartRestoreTrack[]> {
  return readFile(alsPath).then((compressed) => {
    const xml = gunzipSync(compressed).toString("utf8");
    const tracks = parseTopLevelTracks(xml);

    const isSelectableTrack = (
      track: TopLevelTrack
    ): track is TopLevelTrack & { type: "audio" | "midi" | "group" } =>
      track.type !== "return";

    return tracks.filter(isSelectableTrack).map((track) => {
      const closure = resolveRestoreClosure(tracks, [track.id]);
      return {
        id: track.id,
        name: track.name,
        type: track.type,
        groupId: track.groupId,
        dependencyTrackIds: [...closure].filter((id) => {
          const dep = tracks.find((candidate) => candidate.id === id);
          return dep && dep.type !== "return" && id !== track.id;
        }),
        dependencyReturnIds: [...closure].filter((id) => {
          const dep = tracks.find((candidate) => candidate.id === id);
          return dep?.type === "return";
        }),
      } satisfies SmartRestoreTrack;
    });
  });
}

function maxNumericId($: cheerio.CheerioAPI): number {
  let max = 0;
  $("[Id]").each((_, node) => {
    const raw = $(node).attr("Id");
    const value = Number(raw);
    if (Number.isFinite(value)) {
      max = Math.max(max, value);
    }
  });
  return max;
}

function createIdAllocator(start: number) {
  let next = start + 1;
  return () => String(next++);
}

function remapIdsInClone(
  $: cheerio.CheerioAPI,
  root: any,
  allocId: () => string
): Map<string, string> {
  const idMap = new Map<string, string>();
  $(root)
    .add($(root).find("[Id]"))
    .each((_, node) => {
      const raw = $(node).attr("Id");
      if (!raw || node.tagName === "TrackSendHolder") {
        return;
      }
      if (!idMap.has(raw)) {
        idMap.set(raw, allocId());
      }
      $(node).attr("Id", idMap.get(raw)!);
    });
  return idMap;
}

function zeroSendHolder(
  $: cheerio.CheerioAPI,
  holder: any,
  targetIndex: number,
  allocId: () => string
) {
  const clone = $(holder).clone();
  const cloneRoot = clone.get(0);
  if (!cloneRoot) {
    return null;
  }
  remapIdsInClone($, cloneRoot, allocId);
  clone.attr("Id", String(targetIndex));
  clone.children("Send").children("Manual").attr("Value", DEFAULT_SEND_VALUE);
  return cloneRoot;
}

function normalizeTrackSends(
  $: cheerio.CheerioAPI,
  root: any,
  returnIndexMap: Map<number, number>,
  targetReturnCount: number,
  allocId: () => string
) {
  const mixer = directMixer($, root);
  const sends = mixer.children("Sends").first();
  if (sends.length === 0) {
    return;
  }

  const originalHolders = sends.children("TrackSendHolder").toArray();
  if (originalHolders.length === 0) {
    return;
  }

  const byTargetIndex = new Map<number, any>();
  for (const holder of originalHolders) {
    const sourceIndex = Number($(holder).attr("Id") ?? "-1");
    const targetIndex = returnIndexMap.get(sourceIndex);
    if (targetIndex === undefined) {
      continue;
    }
    $(holder).attr("Id", String(targetIndex));
    byTargetIndex.set(targetIndex, holder);
  }

  for (let i = 0; i < targetReturnCount; i++) {
    if (!byTargetIndex.has(i)) {
      const filler = zeroSendHolder($, originalHolders[0]!, i, allocId);
      if (filler) {
        byTargetIndex.set(i, filler);
      }
    }
  }

  sends.empty();
  for (const index of [...byTargetIndex.keys()].sort((a, b) => a - b)) {
    const node = byTargetIndex.get(index);
    if (node) {
      sends.append($.xml(node));
    }
  }
}

function backupFileName(targetAlsPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = basename(targetAlsPath, ".als");
  return `${file} [Echoform Smart Restore ${stamp}].als`;
}

export async function smartRestoreTracks(input: {
  sourceAlsPath: string;
  targetAlsPath: string;
  selectedTrackIds: string[];
}): Promise<SmartRestoreResult> {
  const [sourceCompressed, targetCompressed] = await Promise.all([
    readFile(input.sourceAlsPath),
    readFile(input.targetAlsPath),
  ]);
  const sourceXml = gunzipSync(sourceCompressed).toString("utf8");
  const targetXml = gunzipSync(targetCompressed).toString("utf8");

  const sourceTracks = parseTopLevelTracks(sourceXml);
  const targetTracks = parseTopLevelTracks(targetXml);
  const sourceTrackMap = buildTrackMap(sourceTracks);
  const includedIds = resolveRestoreClosure(
    sourceTracks,
    input.selectedTrackIds
  );
  if (includedIds.size === 0) {
    throw new Error("No matching tracks found in source save.");
  }

  const selectedNames = input.selectedTrackIds
    .map((id) => sourceTrackMap.get(id)?.name)
    .filter((name): name is string => Boolean(name));

  const target$ = loadAlsXml(targetXml);
  const tracksNode = target$("Ableton > LiveSet > Tracks").first();
  if (tracksNode.length !== 1) {
    throw new Error("Target set is missing Tracks node.");
  }

  const allocId = createIdAllocator(maxNumericId(target$));

  const sourceReturns = sourceTracks.filter((track) => track.type === "return");
  const targetReturns = targetTracks.filter((track) => track.type === "return");
  const targetReturnIndexByName = new Map(
    targetReturns.map((track, index) => [track.name, index])
  );
  const returnIndexMap = new Map<number, number>();
  const newReturnTracks: TopLevelTrack[] = [];

  for (const sourceReturn of sourceReturns) {
    const sourceIndex = sourceReturns.findIndex(
      (track) => track.id === sourceReturn.id
    );
    if (!includedIds.has(sourceReturn.id)) {
      continue;
    }
    const existingIndex = targetReturnIndexByName.get(sourceReturn.name);
    if (existingIndex !== undefined) {
      returnIndexMap.set(sourceIndex, existingIndex);
      continue;
    }
    const targetIndex = targetReturns.length + newReturnTracks.length;
    returnIndexMap.set(sourceIndex, targetIndex);
    newReturnTracks.push(sourceReturn);
  }

  const trackIdMap = new Map<string, string>();
  const insertedNormalXml: string[] = [];
  const insertedReturnXml: string[] = [];

  const normalTracksToInsert = sourceTracks.filter(
    (track) => includedIds.has(track.id) && track.type !== "return"
  );
  const allTargetReturnCount = targetReturns.length + newReturnTracks.length;

  for (const track of normalTracksToInsert) {
    const clone$ = loadAlsXml(track.nodeXml);
    const cloneRoot = clone$.root().children().first().get(0);
    if (!cloneRoot) {
      continue;
    }

    const idMap = remapIdsInClone(clone$, cloneRoot, allocId);
    const newTrackId = idMap.get(track.id);
    if (newTrackId) {
      trackIdMap.set(track.id, newTrackId);
    }

    insertedNormalXml.push(clone$.xml(cloneRoot));
  }

  for (const track of newReturnTracks) {
    const clone$ = loadAlsXml(track.nodeXml);
    const cloneRoot = clone$.root().children().first().get(0);
    if (!cloneRoot) {
      continue;
    }

    const idMap = remapIdsInClone(clone$, cloneRoot, allocId);
    const newTrackId = idMap.get(track.id);
    if (newTrackId) {
      trackIdMap.set(track.id, newTrackId);
    }

    insertedReturnXml.push(clone$.xml(cloneRoot));
  }

  const rewriteInsertedTrack = (xml: string) => {
    const clone$ = loadAlsXml(xml);
    const root = clone$.root().children().first().get(0);
    if (!root) {
      return xml;
    }

    const groupIdNode = clone$(root).children("TrackGroupId").first();
    const groupId = groupIdNode.attr("Value");
    if (groupId && groupId !== "-1" && trackIdMap.has(groupId)) {
      groupIdNode.attr("Value", trackIdMap.get(groupId)!);
    }

    normalizeTrackSends(
      clone$,
      root,
      returnIndexMap,
      allTargetReturnCount,
      allocId
    );
    return clone$.xml(root);
  };

  const rewrittenNormalXml = insertedNormalXml.map(rewriteInsertedTrack);
  const rewrittenReturnXml = insertedReturnXml.map(rewriteInsertedTrack);

  const firstReturnNode = tracksNode.children("ReturnTrack").first();
  if (firstReturnNode.length > 0) {
    for (const xml of rewrittenNormalXml) {
      firstReturnNode.before(xml);
    }
  } else {
    for (const xml of rewrittenNormalXml) {
      tracksNode.append(xml);
    }
  }
  for (const xml of rewrittenReturnXml) {
    tracksNode.append(xml);
  }

  const rebuiltXml = target$.xml();
  const rebuiltCompressed = gzipSync(Buffer.from(rebuiltXml, "utf8"));
  const tmpPath = `${input.targetAlsPath}.echoform-smart-restore.tmp`;

  const backupDir = join(dirname(input.targetAlsPath), "Backup");
  await mkdir(backupDir, { recursive: true });
  const backupPath = join(backupDir, backupFileName(input.targetAlsPath));
  await copyFile(input.targetAlsPath, backupPath);

  try {
    await writeFile(tmpPath, rebuiltCompressed);
    await parseAlsFile(tmpPath);
    await rename(tmpPath, input.targetAlsPath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }

  return {
    restoredTrackCount: normalTracksToInsert.length,
    insertedReturnCount: newReturnTracks.length,
    restoredTrackNames: selectedNames,
    insertedReturnNames: newReturnTracks.map((track) => track.name),
    backupPath,
    targetSetPath: input.targetAlsPath,
  };
}
