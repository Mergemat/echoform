# Echoform

Git-like local history for Ableton projects.

Echoform watches selected local project folders, records checkpoints, compares
Ableton set structure, supports attached audio previews, tracks multiple Ableton
sets independently, and starts a new branch from any checkpoint in a verified
working copy. Project files and checkpoint history stay on the machine running
Echoform; releases may send limited usage and crash telemetry to PostHog and
Sentry.

Echoform is version-history software, not a replacement for an independent
backup. Branching creates a separate working copy instead of overwriting the
source project.

```bash
bun install
bun run dev
```

## Commands

```bash
# Desktop app + daemon
bun run dev

# Marketing site
bun run dev:web

# Full repo verification
bun run check

# Fail on dependency advisories beyond the reviewed baseline
bun run audit

# Local desktop artifacts
bun run package:mac

# Cut the next release locally
bun run release:patch
git push --follow-tags
```

## Release Flow

- `apps/desktop/package.json` is the canonical app version.
- `bun run release:patch`, `release:minor`, and `release:major` bump the app version, update `CHANGELOG.md`, create the release commit, and create a `vX.Y.Z` tag.
- `bun run release -- 1.2.3` cuts an explicit version.
- Add `-- --push` to push the branch and tags from the release command.
- GitHub Actions builds macOS and Windows artifacts from the tag and publishes the GitHub Release.
- The website download links and in-app update checker both read the latest GitHub Release tag.

## Dependency Audit

`bun run audit` rejects new high or critical advisory IDs and severity regressions.
The reviewed baseline currently accepts 19 high-severity observations across 12
advisory IDs and no critical advisories. Observation counts remain visible in the
output, while acceptance is always tied to a specific package and advisory ID.
Keep the baseline explicit until upstream transitive fixes are available, and
remove entries as advisories resolve.

## Commit Style

Conventional Commits are the default so the changelog stays clean:

```text
feat(desktop): add update banner
fix(server): harden session bootstrap
chore: refresh release workflow
```
