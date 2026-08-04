import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_WATCHER_DEBOUNCE_MS,
  ProjectWatcher,
  RootWatcher,
} from "./watcher";

describe("ProjectWatcher", () => {
  afterEach(() => {
    mock.restore();
  });

  test("uses the shorter default save debounce", () => {
    const watcher = new ProjectWatcher({
      onChange() {},
      onError() {},
    });

    expect((watcher as any).debounceMs).toBe(DEFAULT_WATCHER_DEBOUNCE_MS);
    expect(DEFAULT_WATCHER_DEBOUNCE_MS).toBe(200);
  });

  test("coalesces rapid changes into a single autosave callback", async () => {
    const onChange = mock();
    const watcher = new ProjectWatcher(
      {
        onChange,
        onError() {},
      },
      50,
    );

    (watcher as any).debouncedChange("proj-1", "Demo", "song.als");
    await Bun.sleep(30);
    (watcher as any).debouncedChange("proj-1", "Demo", "song.als");
    await Bun.sleep(40);

    expect(onChange).not.toHaveBeenCalled();

    await Bun.sleep(20);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("proj-1", "Demo", ["song.als"]);
  });

  test("keeps all changed .als paths in the debounce window", async () => {
    const onChange = mock();
    const watcher = new ProjectWatcher(
      {
        onChange,
        onError() {},
      },
      50,
    );

    (watcher as any).debouncedChange("proj-1", "Demo", "song.als");
    await Bun.sleep(10);
    (watcher as any).debouncedChange("proj-1", "Demo", "song-test.als");
    await Bun.sleep(60);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("proj-1", "Demo", [
      "song.als",
      "song-test.als",
    ]);
  });

  test("rescans queued paths after suppression instead of dropping them", async () => {
    const onChange = mock();
    const watcher = new ProjectWatcher({ onChange, onError() {} }, 10);
    watcher.suppress("proj-1");
    (watcher as any).suppressedChanges.set("proj-1", {
      projectName: "Demo",
      paths: new Set(["song.als", "remix.als"]),
    });

    watcher.unsuppress("proj-1", 0);
    await Bun.sleep(20);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("proj-1", "Demo", [
      "song.als",
      "remix.als",
    ]);
  });

  test("routes rejected async callbacks through watcher error handling", async () => {
    const onError = mock();
    const watcher = new ProjectWatcher(
      {
        async onChange() {
          throw new Error("autosave rejected");
        },
        onError,
      },
      5,
    );

    (watcher as any).debouncedChange("proj-1", "Demo", "song.als");
    await Bun.sleep(15);

    expect(onError).toHaveBeenCalledWith("proj-1", "Demo", "autosave rejected");
  });

  test("in-place reconciliation preserves pending events for existing watchers", async () => {
    const onChange = mock();
    const watcher = new ProjectWatcher({ onChange, onError() {} }, 10);
    (watcher as any).watchers.set("proj-1", { close() {} });
    (watcher as any).debouncedChange("proj-1", "Demo", "song.als");

    const desired = new Set(["proj-1"]);
    for (const projectId of watcher.watchedProjectIds()) {
      if (!desired.has(projectId)) {
        watcher.unwatchProject(projectId);
      }
    }
    await Bun.sleep(20);

    expect(onChange).toHaveBeenCalledWith("proj-1", "Demo", ["song.als"]);
  });

  test("coalesces rapid root changes into a single sync callback", async () => {
    const onChange = mock();
    const watcher = new RootWatcher(
      {
        onChange,
        onError() {},
      },
      50,
    );

    (watcher as any).debouncedChange("root-1", "Ableton");
    await Bun.sleep(30);
    (watcher as any).debouncedChange("root-1", "Ableton");
    await Bun.sleep(40);

    expect(onChange).not.toHaveBeenCalled();

    await Bun.sleep(20);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("root-1", "Ableton");
  });
});
