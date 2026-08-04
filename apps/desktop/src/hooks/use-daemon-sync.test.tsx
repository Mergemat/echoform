import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WsEvent } from "@/lib/types";
import { useDaemonSync } from "./use-daemon-sync";

let daemonEventListener: ((event: WsEvent) => void) | null = null;
const { toastSuccess, toastWarning } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: toastSuccess, warning: toastWarning },
}));
vi.mock("@/lib/daemon-client", () => ({
  startDaemonClient: vi.fn(),
  stopDaemonClient: vi.fn(),
  subscribeCommandFailures: vi.fn(() => vi.fn()),
  subscribeConnection: vi.fn(() => vi.fn()),
  subscribeDaemonEvents: vi.fn((listener: (event: WsEvent) => void) => {
    daemonEventListener = listener;
    return vi.fn();
  }),
}));
vi.mock("@/lib/posthog", () => ({
  posthog: { capture: vi.fn() },
  syncAppProfile: vi.fn(),
}));
vi.mock("@/lib/connection-store", () => ({
  useConnectionStore: {
    getState: () => ({ setConnected: vi.fn() }),
  },
}));
vi.mock("@/lib/preview-store", () => ({
  usePreviewStore: {
    getState: () => ({ reconcilePreviewPlayer: vi.fn() }),
  },
}));
vi.mock("@/lib/store", () => ({
  useStore: {
    getState: () => ({
      applyProjectUpdate: vi.fn(),
      applySnapshot: vi.fn(),
      projects: [],
      selectedProjectId: null,
      setDiscoveredProjects: vi.fn(),
      setRootSuggestions: vi.fn(),
    }),
  },
}));

function HookHarness() {
  useDaemonSync();
  return null;
}

describe("useDaemonSync recovery feedback", () => {
  beforeEach(() => {
    daemonEventListener = null;
    toastSuccess.mockReset();
    toastWarning.mockReset();
    window.echoform = {
      revealPath: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    window.echoform = undefined;
  });

  it("reports the exact recovered path and exposes a reveal action", async () => {
    render(<HookHarness />);
    await waitFor(() => expect(daemonEventListener).not.toBeNull());

    daemonEventListener?.({
      recovery: {
        activeSetPath: "/Music/Echoform Recoveries/Demo/song.als",
        openError: null,
        recoveredPath: "/Music/Echoform Recoveries/Demo",
        recoveredProjectId: "recovered-project-1",
        sourceProjectId: "project-1",
        sourceSaveId: "save-1",
      },
      type: "recovery-created",
    });

    expect(toastSuccess).toHaveBeenCalledWith(
      "New branch opened in Ableton",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Reveal" }),
        description: "/Music/Echoform Recoveries/Demo",
      })
    );
    const toastOptions = toastSuccess.mock.calls[0]?.[1];
    toastOptions.action.onClick();
    expect(window.echoform?.revealPath).toHaveBeenCalledWith(
      "/Music/Echoform Recoveries/Demo"
    );
  });

  it("reports a protected recovery separately from an Ableton launch failure", async () => {
    render(<HookHarness />);
    await waitFor(() => expect(daemonEventListener).not.toBeNull());

    daemonEventListener?.({
      recovery: {
        activeSetPath: "/Music/Echoform Recoveries/Demo/song.als",
        openError: "Ableton is unavailable",
        recoveredPath: "/Music/Echoform Recoveries/Demo",
        recoveredProjectId: "recovered-project-1",
        sourceProjectId: "project-1",
        sourceSaveId: "save-1",
      },
      type: "recovery-created",
    });

    expect(toastWarning).toHaveBeenCalledWith(
      "Branch created, but Ableton did not open",
      expect.objectContaining({
        description: "Ableton is unavailable · /Music/Echoform Recoveries/Demo",
      })
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
