import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Idea, Project, Save } from "@/lib/types";
import { ExpandedCard } from "./expanded-card";

const { sendDaemonCommand } = vi.hoisted(() => ({
  sendDaemonCommand: vi.fn(),
}));

vi.mock("@/lib/daemon-client", () => ({ sendDaemonCommand }));
vi.mock("@/lib/posthog", () => ({
  posthog: { capture: vi.fn() },
}));
vi.mock("./preview-request-dialog", () => ({
  PreviewRequestDialog: () => null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

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
  customLabel: true,
  id: "save-1",
  ideaId: idea.id,
  label: "Chorus landed",
  metadata: {
    activeSetPath: idea.setPath,
    audioFiles: 2,
    fileCount: 5,
    modifiedAt: "2026-08-01T10:00:00.000Z",
    setFiles: [idea.setPath],
    sizeBytes: 1024,
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

function renderCard() {
  return render(
    <ExpandedCard
      idea={idea}
      isHead
      onClose={vi.fn()}
      project={project}
      save={save}
    />
  );
}

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("historical checkpoint actions", () => {
  beforeEach(() => {
    sendDaemonCommand.mockReset();
    sendDaemonCommand.mockResolvedValue({ requestId: "request-1" });
  });

  it("keeps file details advanced and opens a recovered copy from the checkpoint", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(
      screen.getByRole("button", { name: /continue from here/i })
    );
    expect(screen.getByText("Continue from this checkpoint")).toBeVisible();
    expect(screen.queryByText(/Echoform Recoveries/i)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: /advanced: recovery file and location/i,
      })
    );
    expect(screen.getByText(/Music\/Echoform Recoveries/i)).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Create branch and open" })
    );
    await waitFor(() =>
      expect(sendDaemonCommand).toHaveBeenCalledWith(
        {
          open: true,
          projectId: project.id,
          saveId: save.id,
          type: "recover-save",
        },
        { reportError: false }
      )
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Continue from this checkpoint")
      ).not.toBeInTheDocument()
    );
  });

  it("requires confirmation before permanently deleting a checkpoint", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Delete checkpoint" }));
    expect(
      screen.getByRole("heading", { name: "Delete checkpoint?" })
    ).toBeVisible();
    expect(sendDaemonCommand).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep checkpoint" }));
    expect(sendDaemonCommand).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete checkpoint" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete checkpoint" }));
    await waitFor(() =>
      expect(sendDaemonCommand).toHaveBeenCalledWith(
        {
          projectId: project.id,
          saveId: save.id,
          type: "delete-save",
        },
        { reportError: false }
      )
    );
  });

  it("pins the durable checkpoint against automatic cleanup", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Pin checkpoint" }));

    await waitFor(() =>
      expect(sendDaemonCommand).toHaveBeenCalledWith(
        {
          pinned: true,
          projectId: project.id,
          saveId: save.id,
          type: "update-save",
        },
        { reportError: false }
      )
    );
  });

  it("reports only the latest checkpoint edit result", async () => {
    const firstRequest = deferred<{ requestId: string }>();
    const secondRequest = deferred<{ requestId: string }>();
    sendDaemonCommand
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    renderCard();
    const [labelInput, noteInput] = screen.getAllByRole("textbox");

    fireEvent.change(labelInput!, { target: { value: "New label" } });
    fireEvent.blur(labelInput!);
    fireEvent.change(noteInput!, { target: { value: "New note" } });
    fireEvent.blur(noteInput!);

    secondRequest.resolve({ requestId: "request-2" });
    await screen.findByText("Checkpoint details saved to history.");
    firstRequest.reject(new Error("Superseded request failed"));

    await waitFor(() =>
      expect(
        screen.queryByText("Superseded request failed")
      ).not.toBeInTheDocument()
    );
    expect(
      screen.getByText("Checkpoint details saved to history.")
    ).toBeVisible();
  });
});
