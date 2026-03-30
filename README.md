# Echoform

Echoform is a music app that automatically saves Ableton project versions so producers can compare old exports and recover better ideas they would otherwise lose.

## What it does

- Watches Ableton project folders
- Creates version history as your session changes
- Lets you compare saves, preview exports, and restore ideas from older versions

## Local development

This repo uses Bun for both the app and the server workspace.

```bash
bun install
cd server && bun install
cd ..
```

Useful commands:

```bash
bun run lint
bun run typecheck
bun run test:client
bun run test:server
bun run build
bun run app:start
```

## GitHub automation

- `.github/workflows/ci.yml` runs lint, typecheck, tests, and the production web build on pushes and pull requests.
- `.github/workflows/release.yml` publishes macOS release assets when a tag matching `v*` is pushed.

To cut a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```
