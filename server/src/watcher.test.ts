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
      50
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
      50
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

  test("coalesces rapid root changes into a single sync callback", async () => {
    const onChange = mock();
    const watcher = new RootWatcher(
      {
        onChange,
        onError() {},
      },
      50
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
