import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Idea, Project, Save } from "@/lib/types";
import { SetSelector } from "./set-selector";

const idea: Idea = {
  baseSaveId: "save-1",
  createdAt: "2026-08-01T10:00:00.000Z",
  headSaveId: "save-1",
  id: "idea-1",
  name: "Main",
  setPath: "/Music/Demo/Main.als",
};

const save: Save = {
  auto: false,
  createdAt: "2026-08-01T10:00:00.000Z",
  id: "save-1",
  ideaId: idea.id,
  label: "Checkpoint",
  metadata: {
    activeSetPath: idea.setPath,
    audioFiles: 0,
    fileCount: 1,
    modifiedAt: "2026-08-01T10:00:00.000Z",
    setFiles: [idea.setPath],
    sizeBytes: 1,
  },
  note: "",
  pinned: false,
  previewMime: null,
  previewRefs: [],
  previewRequestedAt: null,
  previewStatus: "none",
  previewUpdatedAt: null,
  projectHash: "hash",
};

const project: Project = {
  adapter: "ableton",
  continuedFrom: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  currentIdeaId: idea.id,
  driftStatus: null,
  id: "project-1",
  ideas: [idea],
  lastSeenAt: null,
  name: "Demo",
  pendingOpen: null,
  presence: "active",
  projectPath: "/Music/Demo",
  rootIds: [],
  saves: [save],
  updatedAt: "2026-08-01T10:00:00.000Z",
  watchError: null,
  watching: true,
};

describe("SetSelector", () => {
  it("opens the selected Ableton set", async () => {
    const user = userEvent.setup();
    const onOpenInAbleton = vi.fn();
    render(
      <SetSelector
        activeIdeaId={idea.id}
        onOpenInAbleton={onOpenInAbleton}
        onSelect={vi.fn()}
        project={project}
      />
    );

    await user.click(screen.getByRole("button", { name: "Open in Ableton" }));

    expect(onOpenInAbleton).toHaveBeenCalledWith(idea.id);
  });
});
