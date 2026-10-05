/**
 * Tests for the pure app store selectors and state transitions.
 */

import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/lib/store";
import type { Idea, Project, Save } from "@/lib/types";

const makeIdea = (id: string): Idea => ({
  baseSaveId: "save-1",
  createdAt: "2024-01-01T00:00:00Z",
  headSaveId: "save-1",
  id,
  name: `Idea ${id}`,
  setPath: "project.als",
});

const makeSave = (id: string, ideaId: string): Save => ({
  auto: false,
  createdAt: "2024-01-01T00:00:00Z",
  id,
  ideaId,
  label: `Save ${id}`,
  metadata: {
    activeSetPath: "/project.als",
    audioFiles: 0,
    fileCount: 1,
    modifiedAt: "2024-01-01T00:00:00Z",
    setFiles: [],
    sizeBytes: 1024,
  },
  note: "",
  pinned: false,
  previewMime: null,
  previewRefs: [],
  previewRequestedAt: null,
  previewStatus: "none",
  previewUpdatedAt: null,
  projectHash: "abc123",
});

const makeProject = (
  id: string,
  saves: Save[] = [],
  ideas: Idea[] = []
): Project => ({
  adapter: "ableton",
  continuedFrom: null,
  createdAt: "2024-01-01T00:00:00Z",
  currentIdeaId: ideas[0]?.id ?? "idea-1",
  driftStatus: null,
  id,
  ideas,
  lastSeenAt: "2024-01-01T00:00:00Z",
  name: `Project ${id}`,
  pendingOpen: null,
  presence: "active",
  projectPath: `/projects/${id}`,
  rootIds: [],
  saves,
  updatedAt: "2024-01-01T00:00:00Z",
  watchError: null,
  watching: false,
});

describe("useStore", () => {
  beforeEach(() => {
    act(() => {
      useStore.setState({
        activeIdeaId: null,
        activity: [],
        discoveredProjects: [],
        projects: [],
        rootSuggestions: [],
        roots: [],
        selectedProjectId: null,
        selectedSaveId: null,
      });
    });
  });

  describe("selectedProject()", () => {
    it("returns null when no project is selected", () => {
      expect(useStore.getState().selectedProject()).toBeNull();
    });

    it("returns the matching project when selectedProjectId is set", () => {
      const project = makeProject("proj-1");
      act(() =>
        useStore.setState({ projects: [project], selectedProjectId: "proj-1" })
      );
      expect(useStore.getState().selectedProject()).toEqual(project);
    });
  });

  describe("selectedSave()", () => {
    it("returns null when no save is selected", () => {
      const idea = makeIdea("idea-1");
      const save = makeSave("save-1", "idea-1");
      const project = makeProject("proj-1", [save], [idea]);
      act(() =>
        useStore.setState({
          projects: [project],
          selectedProjectId: "proj-1",
          selectedSaveId: null,
        })
      );
      expect(useStore.getState().selectedSave()).toBeNull();
    });

    it("returns the correct save when both project and save are selected", () => {
      const idea = makeIdea("idea-1");
      const save = makeSave("save-1", "idea-1");
      const project = makeProject("proj-1", [save], [idea]);
      act(() =>
        useStore.setState({
          projects: [project],
          selectedProjectId: "proj-1",
          selectedSaveId: "save-1",
        })
      );
      expect(useStore.getState().selectedSave()).toEqual(save);
    });
  });

  it("selectProject() clears project-scoped selection state", () => {
    act(() =>
      useStore.setState({
        activeIdeaId: "idea-1",
        selectedProjectId: "other",
        selectedSaveId: "save-1",
      })
    );

    act(() => useStore.getState().selectProject("proj-1"));

    expect(useStore.getState().selectedProjectId).toBe("proj-1");
    expect(useStore.getState().selectedSaveId).toBeNull();
    expect(useStore.getState().activeIdeaId).toBeNull();
  });

  it("toggleSave() selects, deselects, and switches saves", () => {
    act(() => useStore.getState().toggleSave("save-1"));
    expect(useStore.getState().selectedSaveId).toBe("save-1");

    act(() => useStore.getState().toggleSave("save-1"));
    expect(useStore.getState().selectedSaveId).toBeNull();

    act(() => useStore.setState({ selectedSaveId: "save-1" }));
    act(() => useStore.getState().toggleSave("save-2"));
    expect(useStore.getState().selectedSaveId).toBe("save-2");
  });

  it("setActiveIdea() clears save selection", () => {
    act(() =>
      useStore.setState({
        activeIdeaId: "old-idea",
        selectedSaveId: "save-1",
      })
    );

    act(() => useStore.getState().setActiveIdea("new-idea"));

    const state = useStore.getState();
    expect(state.activeIdeaId).toBe("new-idea");
    expect(state.selectedSaveId).toBeNull();
  });

  it("applySnapshot() falls back to the first remaining project", () => {
    const idea1 = makeIdea("idea-1");
    const save1 = makeSave("save-1", idea1.id);
    const project1 = makeProject("proj-1", [save1], [idea1]);
    const idea2 = makeIdea("idea-2");
    const save2 = makeSave("save-2", idea2.id);
    const project2 = makeProject("proj-2", [save2], [idea2]);

    act(() =>
      useStore.setState({
        activeIdeaId: idea2.id,
        projects: [project1, project2],
        selectedProjectId: "proj-2",
        selectedSaveId: "save-2",
      })
    );

    act(() => useStore.getState().applySnapshot([project1], [], []));

    const state = useStore.getState();
    expect(state.selectedProjectId).toBe("proj-1");
    expect(state.selectedSaveId).toBeNull();
    expect(state.activeIdeaId).toBeNull();
  });

  it("applyProjectUpdate() follows the current idea and clears removed saves", () => {
    const oldIdea = makeIdea("idea-1");
    const nextIdea = makeIdea("idea-2");
    const save = makeSave("save-1", oldIdea.id);
    const project = makeProject("proj-1", [save], [oldIdea, nextIdea]);

    act(() =>
      useStore.setState({
        activeIdeaId: oldIdea.id,
        projects: [project],
        selectedProjectId: project.id,
        selectedSaveId: save.id,
      })
    );

    act(() =>
      useStore.getState().applyProjectUpdate({
        ...project,
        currentIdeaId: nextIdea.id,
        saves: [],
      })
    );

    const state = useStore.getState();
    expect(state.selectedSaveId).toBeNull();
    expect(state.activeIdeaId).toBe(nextIdea.id);
  });
});
