/**
 * Tests for the pure app store selectors and state transitions.
 */

import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/lib/store";
import type { Idea, Project, Save } from "@/lib/types";

const makeIdea = (id: string): Idea => ({
  id,
  name: `Idea ${id}`,
  createdAt: "2024-01-01T00:00:00Z",
  setPath: "project.als",
  baseSaveId: "save-1",
  headSaveId: "save-1",
  parentIdeaId: null,
  forkedFromSaveId: null,
});

const makeSave = (id: string, ideaId: string): Save => ({
  id,
  label: `Save ${id}`,
  note: "",
  createdAt: "2024-01-01T00:00:00Z",
  ideaId,
  previewRefs: [],
  previewStatus: "none",
  previewMime: null,
  previewRequestedAt: null,
  previewUpdatedAt: null,
  projectHash: "abc123",
  auto: false,
  metadata: {
    activeSetPath: "/project.als",
    setFiles: [],
    audioFiles: 0,
    fileCount: 1,
    sizeBytes: 1024,
    modifiedAt: "2024-01-01T00:00:00Z",
  },
});

const makeProject = (
  id: string,
  saves: Save[] = [],
  ideas: Idea[] = []
): Project => ({
  id,
  name: `Project ${id}`,
  adapter: "ableton",
  projectPath: `/projects/${id}`,
  rootIds: [],
  presence: "active",
  watchError: null,
  lastSeenAt: "2024-01-01T00:00:00Z",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  currentIdeaId: ideas[0]?.id ?? "idea-1",
  pendingOpen: null,
  driftStatus: null,
  ideas,
  saves,
  watching: false,
});

describe("useStore", () => {
  beforeEach(() => {
    act(() => {
      useStore.setState({
        projects: [],
        selectedProjectId: null,
        selectedSaveId: null,
        activeIdeaId: null,
        roots: [],
        activity: [],
        rootSuggestions: [],
        compare: null,
        discoveredProjects: [],
        collapsedBranches: new Set(),
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
        selectedProjectId: "other",
        selectedSaveId: "save-1",
        activeIdeaId: "idea-1",
        compare: {} as never,
      })
    );

    act(() => useStore.getState().selectProject("proj-1"));

    expect(useStore.getState().selectedProjectId).toBe("proj-1");
    expect(useStore.getState().selectedSaveId).toBeNull();
    expect(useStore.getState().activeIdeaId).toBeNull();
    expect(useStore.getState().compare).toBeNull();
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

  it("setActiveIdea() clears save selection and expands the target branch", () => {
    act(() =>
      useStore.setState({
        activeIdeaId: "old-idea",
        selectedSaveId: "save-1",
        collapsedBranches: new Set(["new-idea"]),
      })
    );

    act(() => useStore.getState().setActiveIdea("new-idea"));

    const state = useStore.getState();
    expect(state.activeIdeaId).toBe("new-idea");
    expect(state.selectedSaveId).toBeNull();
    expect(state.collapsedBranches.has("new-idea")).toBe(false);
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
        projects: [project1, project2],
        selectedProjectId: "proj-2",
        selectedSaveId: "save-2",
        activeIdeaId: idea2.id,
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
        projects: [project],
        selectedProjectId: project.id,
        selectedSaveId: save.id,
        activeIdeaId: oldIdea.id,
      })
    );

    act(() =>
      useStore.getState().applyProjectUpdate({
        ...project,
        saves: [],
        currentIdeaId: nextIdea.id,
      })
    );

    const state = useStore.getState();
    expect(state.selectedSaveId).toBeNull();
    expect(state.activeIdeaId).toBe(nextIdea.id);
  });
});
