import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/lib/connection-store";
import { useStore } from "@/lib/store";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/daemon-client", () => ({
  sendDaemonCommand: vi.fn(),
}));

vi.mock("@/components/project-search-command", () => ({
  ProjectSearchCommand: ({
    open,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (open ? <div data-testid="project-search-open" /> : null),
}));

const { AppSidebar } = await import("@/components/sidebar");

describe("AppSidebar search trigger", () => {
  beforeEach(() => {
    useStore.setState({
      projects: [],
      selectedProjectId: null,
      selectedSaveId: null,
      activeIdeaId: null,
      roots: [],
      activity: [],
      rootSuggestions: [],
      rootSuggestionsLoaded: false,
      compare: null,
      discoveredProjects: [],
      collapsedBranches: new Set(),
    });
    useConnectionStore.setState({ connected: true });
  });

  it("opens project search on primary pointer down", () => {
    const view = render(<AppSidebar />);

    fireEvent.pointerDown(
      view.getByRole("button", { name: /search projects/i }),
      {
        button: 0,
      }
    );

    expect(view.getByTestId("project-search-open")).toBeTruthy();
  });
});
