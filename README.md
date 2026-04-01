# Echoform

Desktop version history for Ableton projects.

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

## Commit Style

Conventional Commits are the default so the changelog stays clean:

```text
feat(desktop): add update banner
fix(server): harden session bootstrap
chore: refresh release workflow
```
