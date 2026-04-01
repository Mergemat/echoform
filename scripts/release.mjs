import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(import.meta.url)).replace(/[/\\]scripts$/, "");
const desktopDir = join(repoRoot, "apps", "desktop");

function bunExecutable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result.stdout.trim();
}

function runStreaming(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function usage() {
  return [
    "Usage:",
    "  bun run release -- <version> [--push] [--dry-run]",
    "  bun run release:patch [-- --push]",
    "  bun run release:minor [-- --push]",
    "  bun run release:major [-- --push]",
  ].join("\n");
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let help = false;
  let push = false;
  let target = null;

  for (const arg of args) {
    if (arg === "--push") {
      push = true;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg.startsWith("--")) {
      fail(`Unknown flag: ${arg}\n\n${usage()}`);
    }

    if (target !== null) {
      fail(`Unexpected extra argument: ${arg}\n\n${usage()}`);
    }

    target = arg;
  }

  return { dryRun, help, push, target };
}

function ensureValidTarget(target, help) {
  if (help) {
    console.log(usage());
    process.exit(0);
  }

  if (target === null) {
    fail(`Missing release target.\n\n${usage()}`);
  }

  if (["patch", "minor", "major"].includes(target)) {
    return;
  }

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(target)) {
    fail(`Invalid release target: ${target}\n\n${usage()}`);
  }
}

function pushRelease() {
  const branch = run("git", ["branch", "--show-current"]);
  if (!branch) {
    fail("Cannot push a release from a detached HEAD.");
  }

  const upstream = spawnSync(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    {
      cwd: repoRoot,
      stdio: "ignore",
    },
  );

  if (upstream.status === 0) {
    runStreaming("git", ["push", "--follow-tags"]);
    return;
  }

  runStreaming("git", ["push", "-u", "origin", branch, "--follow-tags"]);
}

function main() {
  const { dryRun, help, push, target } = parseArgs();
  ensureValidTarget(target, help);

  const releaseItArgs = ["release-it", target, "--ci"];
  if (dryRun) {
    releaseItArgs.push("--dry-run");
    releaseItArgs.push("--git.requireCleanWorkingDir=false");
  }

  runStreaming(bunExecutable("bunx"), releaseItArgs, desktopDir);

  if (push && !dryRun) {
    pushRelease();
  }
}

main();
