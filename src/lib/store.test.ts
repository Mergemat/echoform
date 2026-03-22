/**
 * Tests for useStore computed selectors and actions.
 * These cover the core state management logic of the app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import type { Project, Save, Idea } from '@/lib/types';

// Mock window.location and WebSocket since jsdom doesn't provide them
Object.defineProperty(window, 'location', {
  value: { protocol: 'http:', host: 'localhost' },
  writable: true,
});
global.WebSocket = vi.fn().mockImplementation(() => ({
  readyState: 3, // CLOSED
  send: vi.fn(),
  close: vi.fn(),
})) as unknown as typeof WebSocket;
(global.WebSocket as unknown as { OPEN: number; CONNECTING: number }).OPEN = 1;
(
  global.WebSocket as unknown as { OPEN: number; CONNECTING: number }
).CONNECTING = 0;

// Mock fetch and sonner before importing the store
global.fetch = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const makeIdea = (id: string): Idea => ({
  id,
  name: `Idea ${id}`,
  createdAt: '2024-01-01T00:00:00Z',
  baseSaveId: 'save-1',
  headSaveId: 'save-1',
  parentIdeaId: null,
  forkedFromSaveId: null,
});

const makeSave = (id: string, ideaId: string): Save => ({
  id,
  label: `Save ${id}`,
  note: '',
  createdAt: '2024-01-01T00:00:00Z',
  ideaId,
  previewRefs: [],
  projectHash: 'abc123',
  auto: false,
  metadata: {
    activeSetPath: '/project.als',
    setFiles: [],
    audioFiles: 0,
    fileCount: 1,
    sizeBytes: 1024,
    modifiedAt: '2024-01-01T00:00:00Z',
  },
});

const makeProject = (
  id: string,
  saves: Save[] = [],
  ideas: Idea[] = [],
): Project => ({
  id,
  name: `Project ${id}`,
  adapter: 'ableton',
  projectPath: `/projects/${id}`,
  activeSetPath: `/projects/${id}/project.als`,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  currentIdeaId: ideas[0]?.id ?? 'idea-1',
  lastRestoredSaveId: null,
  detachedRestore: null,
  ideas,
  saves,
  watching: false,
});

describe('useStore', () => {
  let store: (typeof import('@/lib/store'))['useStore'];
  let wsInstance: {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onopen: (() => void) | null;
    onclose: (() => void) | null;
    onmessage: ((event: { data: string }) => void) | null;
  };

  beforeEach(async () => {
    vi.resetModules();
    wsInstance = {
      readyState: 0,
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onclose: null,
      onmessage: null,
    };
    global.WebSocket = vi
      .fn(function WebSocketMock() {
        return wsInstance;
      }) as unknown as typeof WebSocket;
    (global.WebSocket as unknown as { OPEN: number; CONNECTING: number }).OPEN = 1;
    (
      global.WebSocket as unknown as { OPEN: number; CONNECTING: number }
    ).CONNECTING = 0;
    vi.mocked(global.fetch).mockReset();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
    } as Response);
    const mod = await import('@/lib/store');
    store = mod.useStore;
    // Reset to initial state
    act(() => {
      store.setState({
        projects: [],
        selectedProjectId: null,
        selectedSaveId: null,
        activeIdeaId: null,
        compare: null,
        connected: false,
        ws: null,
        discoveredProjects: [],
      });
    });
  });

  describe('selectedProject()', () => {
    it('returns null when no project is selected', () => {
      const project = store.getState().selectedProject();
      expect(project).toBeNull();
    });

    it('returns the matching project when selectedProjectId is set', () => {
      const p = makeProject('proj-1');
      act(() => store.setState({ projects: [p], selectedProjectId: 'proj-1' }));
      expect(store.getState().selectedProject()).toEqual(p);
    });

    it('returns null when selectedProjectId does not match any project', () => {
      const p = makeProject('proj-1');
      act(() =>
        store.setState({ projects: [p], selectedProjectId: 'proj-999' }),
      );
      expect(store.getState().selectedProject()).toBeNull();
    });
  });

  describe('selectedSave()', () => {
    it('returns null when no save is selected', () => {
      const idea = makeIdea('idea-1');
      const save = makeSave('save-1', 'idea-1');
      const p = makeProject('proj-1', [save], [idea]);
      act(() =>
        store.setState({
          projects: [p],
          selectedProjectId: 'proj-1',
          selectedSaveId: null,
        }),
      );
      expect(store.getState().selectedSave()).toBeNull();
    });

    it('returns the correct save when both project and save are selected', () => {
      const idea = makeIdea('idea-1');
      const save = makeSave('save-1', 'idea-1');
      const p = makeProject('proj-1', [save], [idea]);
      act(() =>
        store.setState({
          projects: [p],
          selectedProjectId: 'proj-1',
          selectedSaveId: 'save-1',
        }),
      );
      expect(store.getState().selectedSave()).toEqual(save);
    });
  });

  describe('selectProject()', () => {
    it('sets selectedProjectId and clears selectedSaveId and activeIdeaId', () => {
      const p = makeProject('proj-1');
      act(() =>
        store.setState({
          projects: [p],
          selectedProjectId: 'other',
          selectedSaveId: 'some-save',
          activeIdeaId: 'some-idea',
        }),
      );
      act(() => store.getState().selectProject('proj-1'));
      const state = store.getState();
      expect(state.selectedProjectId).toBe('proj-1');
      expect(state.selectedSaveId).toBeNull();
      expect(state.activeIdeaId).toBeNull();
    });
  });

  describe('toggleSave()', () => {
    it('selects a save when none is selected', () => {
      act(() => store.setState({ selectedSaveId: null }));
      act(() => store.getState().toggleSave('save-1'));
      expect(store.getState().selectedSaveId).toBe('save-1');
    });

    it('deselects a save when the same save is toggled again', () => {
      act(() => store.setState({ selectedSaveId: 'save-1' }));
      act(() => store.getState().toggleSave('save-1'));
      expect(store.getState().selectedSaveId).toBeNull();
    });

    it('switches to a different save when a different save is toggled', () => {
      act(() => store.setState({ selectedSaveId: 'save-1' }));
      act(() => store.getState().toggleSave('save-2'));
      expect(store.getState().selectedSaveId).toBe('save-2');
    });
  });

  describe('setActiveIdea()', () => {
    it('sets activeIdeaId and clears selectedSaveId', () => {
      act(() =>
        store.setState({
          activeIdeaId: 'old-idea',
          selectedSaveId: 'some-save',
        }),
      );
      act(() => store.getState().setActiveIdea('new-idea'));
      const state = store.getState();
      expect(state.activeIdeaId).toBe('new-idea');
      expect(state.selectedSaveId).toBeNull();
    });
  });

  describe('projects event handling', () => {
    it('falls back to the first remaining project when the selected project is removed', async () => {
      const idea1 = makeIdea('idea-1');
      const save1 = makeSave('save-1', idea1.id);
      const project1 = makeProject('proj-1', [save1], [idea1]);
      const idea2 = makeIdea('idea-2');
      const save2 = makeSave('save-2', idea2.id);
      const project2 = makeProject('proj-2', [save2], [idea2]);

      act(() =>
        store.setState({
          projects: [project1, project2],
          selectedProjectId: 'proj-2',
          selectedSaveId: 'save-2',
          activeIdeaId: idea2.id,
        }),
      );

      await store.getState().connect();

      act(() => {
        wsInstance.onmessage?.({
          data: JSON.stringify({
            type: 'projects',
            projects: [project1],
          }),
        });
      });

      const state = store.getState();
      expect(state.selectedProjectId).toBe('proj-1');
      expect(state.selectedSaveId).toBeNull();
      expect(state.activeIdeaId).toBeNull();
    });
  });
});
