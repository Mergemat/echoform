# TODOS

Deferred items from the `feat/vertical-timeline` engineering review (2026-03-21).
Updated during Creative Memory v1 implementation.

---

## Cache preview path allowlist in `resolvePreviewPath`

**Priority:** Low (not blocking until audio preview ships)

Add an in-memory cache of allowed preview paths, invalidated on state save, to avoid re-reading `state.json` from disk on every `/api/media` request.

When audio preview rendering ships, N media requests per timeline render will each do a full `state.json` disk read + parse. Fix is ~15 lines: maintain a `Set<string>` updated in `saveState()`.

**Where:** `server/src/core.ts` (`resolvePreviewPath`)
**Depends on:** Audio A/B feature being connected to the timeline UI.

---

## Use content-based hashing instead of mtime for change detection

**Priority:** Medium

Replace mtime-based hashing in `hashFiles()` with content-based hashing (SHA-256 of file contents) for `.als` files. Touching a file without changing its content (e.g., rsync, backup tools, Ableton auto-save) triggers a spurious auto-save that copies the entire project directory.

Compromise approach: hash content for `.als` files only, keep mtime for everything else. This avoids the performance cost of hashing large sample files while eliminating false positives on the files that matter.

**Where:** `server/src/core.ts` (`hashFiles`), consumed by `createSave`
**Depends on:** Nothing. Needs benchmarking with large projects.

---

## ~~Switch file watcher to `recursive: true`~~ DONE

Completed: `watcher.ts` line 37 now uses `{ recursive: true }`.

---

## ~~Add serialization queue for `state.json` mutations~~ DONE

Completed: `AsyncMutex` implemented in `core.ts` (lines 230-265). All mutating methods use `withLock()`.
