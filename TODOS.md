# TODOS

Deferred items from the `feat/vertical-timeline` engineering review (2026-03-21).

---

## Cache preview path allowlist in `resolvePreviewPath`

**Priority:** Low (not blocking until audio preview ships)

Add an in-memory cache of allowed preview paths, invalidated on state save, to avoid re-reading `state.json` from disk on every `/api/media` request.

When audio preview rendering ships (design doc Open Question #7), N media requests per timeline render will each do a full `state.json` disk read + parse. Fix is ~15 lines: maintain a `Set<string>` updated in `saveState()`.

**Where:** `server/src/core.ts:421-434` (`resolvePreviewPath`)
**Depends on:** Audio preview feature being connected to the timeline UI.

---

## Switch file watcher to `recursive: true`

**Priority:** Medium

Change `watcher.ts` line 35 from `recursive: false` to `recursive: true` to catch `.als` saves in project subdirectories. Some Ableton project structures have `.als` files nested inside subdirectories; the current watcher only watches the top-level project directory.

Bun supports recursive watching on macOS via FSEvents. The existing debounce timer (3s) already handles event storms. Need to filter out `Backup/` directory events to avoid noise.

**Where:** `server/src/watcher.ts:35`
**Depends on:** Nothing. Should be tested with a real Ableton project that has subdirectory `.als` files.

---

## Use content-based hashing instead of mtime for change detection

**Priority:** Medium

Replace mtime-based hashing in `hashFiles()` with content-based hashing (SHA-256 of file contents) for `.als` files. Touching a file without changing its content (e.g., rsync, backup tools, Ableton auto-save) triggers a spurious auto-save that copies the entire project directory.

Compromise approach: hash content for `.als` files only, keep mtime for everything else. This avoids the performance cost of hashing large sample files while eliminating false positives on the files that matter.

**Where:** `server/src/core.ts:71-75` (`hashFiles`), consumed at `core.ts:240`
**Depends on:** Nothing. Needs benchmarking with large projects.

---

## Add serialization queue for `state.json` mutations

**Priority:** Medium

Add a mutex/queue around `loadState` + `saveState` to prevent concurrent WS commands or auto-save from racing on `state.json`. If auto-save fires while a user manually creates an idea, both call `loadState()` concurrently, modify different parts, and the last `saveState()` wins — silently dropping the other's changes.

Bun's single-threaded event loop reduces but doesn't eliminate the risk — any `await` between load and save opens a race window. The fix is a simple async mutex that serializes all state mutations.

**Where:** `server/src/core.ts` — all methods that call `loadState()` + `saveState()`
**Depends on:** Nothing. Can be done as a standalone hardening PR.
