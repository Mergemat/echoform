# Echoform

Echoform is a music app that automatically saves Ableton project versions so producers can compare old exports and recover better ideas they would otherwise lose.

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
