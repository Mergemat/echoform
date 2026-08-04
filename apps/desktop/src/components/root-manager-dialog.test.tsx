import { fireEvent, render, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/daemon-client", () => ({
  sendDaemonCommand: vi.fn(),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { RootManagerDialog } from "@/components/root-manager-dialog";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { useStore } from "@/lib/store";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
  window: dom.window,
});
Object.assign(window, {
  echoform: undefined,
});

describe("RootManagerDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.echoform = undefined;
    useStore.setState({
      activeIdeaId: null,
      activity: [],
      compare: null,
      discoveredProjects: [],
      projects: [],
      rootSuggestions: [],
      rootSuggestionsLoaded: false,
      roots: [],
      selectedProjectId: null,
      selectedSaveId: null,
    });
  });

  it("does not trigger a full root sync when opened", async () => {
    render(<RootManagerDialog onOpenChange={vi.fn()} open />);

    await waitFor(() => {
      expect(sendDaemonCommand).toHaveBeenCalledWith({
        type: "discover-root-suggestions",
      });
    });

    expect(sendDaemonCommand).not.toHaveBeenCalledWith({
      type: "sync-roots",
    });
  });

  it("adds a watched root from the native folder picker", async () => {
    window.echoform = {
      pickFolder: vi
        .fn()
        .mockResolvedValue("/Users/test/Music/Ableton/My Projects"),
    };

    const view = render(<RootManagerDialog onOpenChange={vi.fn()} open />);

    fireEvent.click(view.getByText("Choose folder"));

    await waitFor(() => {
      expect(sendDaemonCommand).toHaveBeenCalledWith({
        path: "/Users/test/Music/Ableton/My Projects",
        type: "add-root",
      });
    });

    expect(sendDaemonCommand).toHaveBeenCalledWith({
      type: "discover-root-suggestions",
    });
  });
});
