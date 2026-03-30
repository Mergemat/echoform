import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import * as cheerio from "cheerio";
import { Builder, Parser } from "xml2js";
import { diffSets, isEmptyDiff } from "./als-diff";
import { parseAlsFile } from "./als-parser";

interface GateSummary {
  automationTagCount: number;
  fixture: string;
  originalCompressedBytes: number;
  originalReturnTrackCount: number;
  originalTrackCount: number;
  originalXmlBytes: number;
  parsedWithCheerio: boolean;
  rebuiltCompressedBytes: number;
  rebuiltReturnTrackCount: number;
  rebuiltTrackCount: number;
  rebuiltXmlBytes: number;
  semanticRoundTripOk: boolean;
}

function fail(message: string): never {
  throw new Error(`Smart Restore feasibility gate failed: ${message}`);
}

async function main() {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    fail(
      "usage: bun src/smart-restore-feasibility.ts /absolute/path/to/file.als"
    );
  }

  const compressed = await readFile(fixturePath);
  const xml = gunzipSync(compressed).toString("utf8");

  const $ = cheerio.load(xml, { xmlMode: true });
  const liveSet = $("Ableton > LiveSet");
  if (liveSet.length !== 1) {
    fail("missing Ableton > LiveSet root");
  }

  const originalTrackCount = $("Ableton > LiveSet > Tracks").children().length;
  const originalReturnTrackCount = $(
    "Ableton > LiveSet > Tracks > ReturnTrack"
  ).length;
  const automationTagCount = $(
    '[Name="Automation"], AutomationEnvelopes, Envelopes, ArrangerAutomation'
  ).length;

  const parser = new Parser({
    explicitArray: false,
    preserveChildrenOrder: true,
    attrkey: "$",
    charkey: "_",
  });
  const parsed = await parser.parseStringPromise(xml);

  const builder = new Builder({
    attrkey: "$",
    charkey: "_",
    headless: false,
    renderOpts: { pretty: false },
  });
  const rebuiltXml = builder.buildObject(parsed);
  const rebuiltCompressed = gzipSync(Buffer.from(rebuiltXml, "utf8"));

  const tmpDir = await mkdtemp(join(tmpdir(), "echoform-smart-restore-"));
  const rebuiltPath = join(tmpDir, basename(fixturePath));

  try {
    await writeFile(rebuiltPath, rebuiltCompressed);

    const [originalSnapshot, rebuiltSnapshot] = await Promise.all([
      parseAlsFile(fixturePath),
      parseAlsFile(rebuiltPath),
    ]);

    const diff = diffSets(originalSnapshot, rebuiltSnapshot);
    const rebuiltXmlDoc = cheerio.load(rebuiltXml, { xmlMode: true });

    const summary: GateSummary = {
      fixture: fixturePath,
      originalCompressedBytes: compressed.length,
      originalXmlBytes: Buffer.byteLength(xml, "utf8"),
      rebuiltCompressedBytes: rebuiltCompressed.length,
      rebuiltXmlBytes: Buffer.byteLength(rebuiltXml, "utf8"),
      originalTrackCount,
      rebuiltTrackCount: rebuiltXmlDoc("Ableton > LiveSet > Tracks").children()
        .length,
      originalReturnTrackCount,
      rebuiltReturnTrackCount: rebuiltXmlDoc(
        "Ableton > LiveSet > Tracks > ReturnTrack"
      ).length,
      automationTagCount,
      parsedWithCheerio: true,
      semanticRoundTripOk: isEmptyDiff(diff),
    };

    if (!summary.semanticRoundTripOk) {
      console.error(JSON.stringify({ summary, diff }, null, 2));
      fail("semantic diff detected after xml2js round-trip");
    }

    if (summary.originalTrackCount !== summary.rebuiltTrackCount) {
      fail("track count changed after round-trip");
    }
    if (summary.originalReturnTrackCount !== summary.rebuiltReturnTrackCount) {
      fail("return track count changed after round-trip");
    }

    console.log(JSON.stringify({ summary }, null, 2));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
