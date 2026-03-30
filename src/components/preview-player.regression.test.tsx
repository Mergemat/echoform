import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewPlayer } from "@/components/preview-player";
import type { Project, Save } from "@/lib/types";

type WaveSurferHandler = (...args: unknown[]) => void;

class MockWaveSurfer {
  static instances: MockWaveSurfer[] = [];

  handlers = new Map<string, WaveSurferHandler[]>();
  currentTime = 0;
  playing = false;
  destroyed = false;
  volume = 1;
  play = vi.fn(async () => {
    this.playing = true;
    this.emit("play");
  });
  pause = vi.fn(() => {
    this.playing = false;
    this.emit("pause");
  });
  destroy = vi.fn(() => {
    this.destroyed = true;
    this.playing = false;
  });
  isPlaying = vi.fn(() => this.playing);
  getCurrentTime = vi.fn(() => this.currentTime);
  setTime = vi.fn((time: number) => {
    this.currentTime = time;
  });
  setVolume = vi.fn((value: number) => {
    this.volume = value;
  });

  on(event: string, handler: WaveSurferHandler) {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

vi.mock("wavesurfer.js", () => ({
  default: {
    create: vi.fn(() => {
      const instance = new MockWaveSurfer();
      MockWaveSurfer.instances.push(instance);
      return instance;
    }),
  },
}));

function makeSave(
  id: string,
  label: string,
  previewRef: string,
  createdAt: string
): Save {
  return {
    id,
    label,
    note: "",
    createdAt,
    ideaId: "idea-1",
    previewRefs: [previewRef],
    previewStatus: "ready",
    previewMime: "audio/wav",
    previewRequestedAt: null,
    previewUpdatedAt: null,
    projectHash: `${id}-hash`,
    auto: false,
    metadata: {
      activeSetPath: "song.als",
      setFiles: ["song.als"],
      audioFiles: 1,
      fileCount: 1,
      sizeBytes: 100,
      modifiedAt: createdAt,
    },
  };
}

function makeProject(): Project {
  const left = makeSave(
    "save-a",
    "Save A",
    "/tmp/a.wav",
    "2024-01-01T00:00:00Z"
  );
  const right = makeSave(
    "save-b",
    "Save B",
    "/tmp/b.wav",
    "2024-01-02T00:00:00Z"
  );

  return {
    id: "project-1",
    name: "Project",
    adapter: "ableton",
    projectPath: "/tmp/project",
    rootIds: ["root-1"],
    presence: "active",
    watchError: null,
    lastSeenAt: "2024-01-02T00:00:00Z",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
    currentIdeaId: "idea-1",
    pendingOpen: null,
    driftStatus: null,
    ideas: [
      {
        id: "idea-1",
        name: "Main",
        createdAt: "2024-01-01T00:00:00Z",
        setPath: "song.als",
        baseSaveId: "save-a",
        headSaveId: "save-b",
        parentIdeaId: null,
        forkedFromSaveId: null,
      },
    ],
    saves: [left, right],
    watching: true,
  };
}

describe("PreviewPlayer compare switching", () => {
  beforeEach(() => {
    MockWaveSurfer.instances = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps exactly two players and switches by volume while preserving time", async () => {
    const project = makeProject();
    render(
      <PreviewPlayer
        onClose={vi.fn()}
        project={project}
        save={project.saves[0]!}
      />
    );

    const laneA = MockWaveSurfer.instances[0]!;
    act(() => {
      laneA.emit("decode", 90);
      laneA.emit("ready");
    });

    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "save-b" },
      });
    });

    const laneB = MockWaveSurfer.instances[1]!;
    laneA.currentTime = 18;
    act(() => {
      laneA.emit("timeupdate", 18);
      laneB.emit("decode", 95);
      laneB.emit("ready");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play preview" }));
    });

    expect(MockWaveSurfer.instances).toHaveLength(2);
    expect(laneA.play).toHaveBeenCalledTimes(1);
    expect(laneB.play).toHaveBeenCalledTimes(1);
    expect(laneA.setTime).toHaveBeenLastCalledWith(18);
    expect(laneB.setTime).toHaveBeenLastCalledWith(18);
    expect(laneA.volume).toBe(0);
    expect(laneB.volume).toBe(1);

    laneB.currentTime = 32;
    act(() => {
      laneB.emit("timeupdate", 32);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "`" });
    });

    expect(MockWaveSurfer.instances).toHaveLength(2);
    expect(laneA.destroy).not.toHaveBeenCalled();
    expect(laneB.destroy).not.toHaveBeenCalled();
    expect(laneA.volume).toBe(1);
    expect(laneB.volume).toBe(0);

    act(() => {
      laneA.emit("timeupdate", 32);
    });

    expect(screen.getAllByText("A").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/0:32 \/ 1:30/)).toBeInTheDocument();
  });

  it("pauses the current preview before switching to another save", async () => {
    const project = makeProject();
    const { rerender } = render(
      <PreviewPlayer
        key={project.saves[0]?.id}
        onClose={vi.fn()}
        project={project}
        save={project.saves[0]!}
      />
    );

    const firstLane = MockWaveSurfer.instances[0]!;
    act(() => {
      firstLane.emit("decode", 90);
      firstLane.emit("ready");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play preview" }));
    });

    expect(firstLane.play).toHaveBeenCalledTimes(1);
    expect(firstLane.pause).not.toHaveBeenCalled();

    rerender(
      <PreviewPlayer
        key={project.saves[1]?.id}
        onClose={vi.fn()}
        project={project}
        save={project.saves[1]!}
      />
    );

    expect(firstLane.pause).toHaveBeenCalled();
    expect(firstLane.destroy).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Play preview" })
    ).toBeInTheDocument();
    expect(MockWaveSurfer.instances[1]?.play).not.toHaveBeenCalled();
  });
});
