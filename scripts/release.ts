import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = import.meta.dir.replace(/[/\\]scripts$/, "");
const packageJsonPath = join(rootDir, "package.json");

interface PackageJson {
  version: string;
  [key: string]: unknown;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function run(command: string, args: string[], options?: { capture?: boolean }) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: options?.capture ? "pipe" : "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function gitOutput(...args: string[]) {
  return run("git", args, { capture: true }).stdout.trim();
}

function ensureCleanWorktree() {
  const status = gitOutput("status", "--short");
  if (status.length > 0) {
    fail("Refusing to cut a release from a dirty worktree.");
  }
}

function ensureTagMissing(tagName: string) {
  const existing = gitOutput("tag", "--list", tagName);
  if (existing === tagName) {
    fail(`Tag ${tagName} already exists.`);
  }
}

function parseVersionArg(): { push: boolean; version: string } {
  const args = process.argv.slice(2);
  const push = args.includes("--push");
  const version = args.find((arg) => !arg.startsWith("--"));

  if (!version) {
    fail("Usage: bun run release:ship <version> [--push]");
  }

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`Invalid version: ${version}`);
  }

  return { push, version };
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
}

function writeVersion(version: string) {
  const packageJson = readPackageJson();
  packageJson.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function main() {
  const { push, version } = parseVersionArg();
  const packageJson = readPackageJson();
  const currentVersion = packageJson.version;
  const tagName = `v${version}`;

  if (currentVersion === version) {
    fail(`package.json is already at ${version}.`);
  }

  ensureCleanWorktree();
  ensureTagMissing(tagName);

  console.log(`Bumping version ${currentVersion} -> ${version}`);
  writeVersion(version);

  run("bun", ["run", "lint"]);
  run("bun", ["run", "typecheck"]);
  run("bun", ["run", "test"]);
  run("bun", ["run", "release"]);

  run("git", ["add", "package.json"]);
  run("git", ["commit", "-m", `chore: release ${tagName}`]);
  run("git", ["tag", tagName]);

  if (push) {
    run("git", ["push", "origin", "HEAD"]);
    run("git", ["push", "origin", tagName]);
  }

  console.log(`Release ${tagName} complete.`);
}

main();
