import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExpandedCard } from "@/components/expanded-card";
import { usePreviewStore } from "@/lib/preview-store";
import type { Idea, Project, Save } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/smart-restore-dialog", () => ({
  SmartRestoreDialog: () => null,
}));

vi.mock("@/components/preview-request-dialog", () => ({
  PreviewRequestDialog: () => null,
}));

vi.mock("@/lib/daemon-client", () => ({
  sendDaemonCommand: vi.fn(),
}));

function makeIdea(): Idea {
  return {
    id: "idea-1",
    name: "Main",
    createdAt: "2024-01-01T00:00:00Z",
    setPath: "song.als",
    baseSaveId: "save-1",
    headSaveId: "save-1",
    parentIdeaId: null,
    forkedFromSaveId: null,
  };
}

function makeSave(status: Save["previewStatus"]): Save {
  return {
    id: "save-1",
    label: "Initial save",
    note: "",
    createdAt: "2024-01-01T00:00:00Z",
    ideaId: "idea-1",
    previewRefs: status === "ready" ? ["/tmp/preview.wav"] : [],
    previewStatus: status,
    previewMime: status === "ready" ? "audio/wav" : null,
    previewRequestedAt: status === "pending" ? "2024-01-01T00:00:00Z" : null,
    previewUpdatedAt: null,
    projectHash: "hash",
    auto: false,
    metadata: {
      activeSetPath: "song.als",
      setFiles: ["song.als"],
      audioFiles: 0,
      fileCount: 1,
      sizeBytes: 100,
      modifiedAt: "2024-01-01T00:00:00Z",
    },
  };
}

function makeProject(save: Save): Project {
  return {
    id: "proj-1",
    name: "Test Project",
    projectPath: "/tmp/test",
    adapter: "ableton",
    presence: "active",
    watching: true,
    watchError: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    lastSeenAt: "2024-01-01T00:00:00Z",
    currentIdeaId: "idea-1",
    pendingOpen: null,
    driftStatus: null,
    rootIds: [],
    ideas: [makeIdea()],
    saves: [save],
  };
}

describe("ExpandedCard preview actions", () => {
  const openPreviewPlayer = vi.fn();

  beforeEach(() => {
    openPreviewPlayer.mockReset();
    usePreviewStore.setState({
      previewPlayerSaveId: null,
      compareSaveId: null,
      openPreviewPlayer,
      closePreviewPlayer: vi.fn(),
      setCompareSaveId: vi.fn(),
      reconcilePreviewPlayer: vi.fn(),
    });
  });

  it("shows Add preview when no preview exists", () => {
    const save = makeSave("none");
    const view = render(
      <ExpandedCard
        idea={makeIdea()}
        isHead={false}
        onClose={vi.fn()}
        project={makeProject(save)}
        save={save}
      />
    );

    expect(view.getAllByRole("button", { name: "Add preview" }).length).toBe(1);
  });

  it("shows Add preview when preview is pending (no waiting state)", () => {
    const save = makeSave("pending");
    const view = render(
      <ExpandedCard
        idea={makeIdea()}
        isHead={false}
        onClose={vi.fn()}
        project={makeProject(save)}
        save={save}
      />
    );

    expect(view.getAllByRole("button", { name: "Add preview" }).length).toBe(1);
  });

  it("opens the preview player when the preview is ready", () => {
    const save = makeSave("ready");
    const view = render(
      <ExpandedCard
        idea={makeIdea()}
        isHead={false}
        onClose={vi.fn()}
        project={makeProject(save)}
        save={save}
      />
    );

    fireEvent.click(view.getByRole("button", { name: "Preview" }));

    expect(openPreviewPlayer).toHaveBeenCalledWith(
      "save-1",
      expect.objectContaining({ id: "proj-1" })
    );
  });
});
