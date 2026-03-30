# Echoform

Echoform is a desktop app for Ableton producers who want real version history without changing how they work. It watches your projects in the background, captures each save, and gives you a clean timeline for comparing, previewing, and recovering earlier ideas.

## What it does

- Watches folders that contain Ableton projects
- Tracks new saves automatically in the background
- Lets you browse project history as a timeline
- Supports audio previews so old versions are easy to identify
- Opens or recovers earlier versions when a newer idea goes sideways

## Current scope

- Desktop app built with Electron, React, TypeScript, and Bun
- Focused on Ableton Live project history and recovery
- Currently packaged for macOS

## Local development

This repo uses Bun for both the app and the server workspace.

```bash
bun install
cd server && bun install
cd ..
```

Useful commands:

```bash
bun run dev
bun run test
bun run check
bun run dist
```

## Releasing

Local packaged builds:

```bash
bun run release
```

Cut a versioned release commit and tag:

```bash
bun run release:ship 0.0.2
```

Cut and push the release:

```bash
bun run release:ship 0.0.2 --push
```
