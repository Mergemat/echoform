import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import type { Project, Idea, Save } from '@/lib/types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { ProjectItem } from '@/components/sidebar';
import { useStore } from '@/lib/store';
import { TooltipProvider } from '@/components/ui/tooltip';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
});

const makeIdea = (id: string): Idea => ({
  id,
  name: 'Main',
  createdAt: '2024-01-01T00:00:00Z',
  setPath: 'project.als',
  baseSaveId: 'save-1',
  headSaveId: 'save-1',
  parentIdeaId: null,
  forkedFromSaveId: null,
});

const makeSave = (id: string, ideaId: string): Save => ({
  id,
  label: 'Initial save',
  note: '',
  createdAt: '2024-01-01T00:00:00Z',
  ideaId,
  previewRefs: [],
  previewStatus: 'none',
  previewMime: null,
  previewRequestedAt: null,
  previewUpdatedAt: null,
  projectHash: 'abc123',
  auto: false,
  metadata: {
    activeSetPath: '/projects/test/project.als',
    setFiles: [],
    audioFiles: 0,
    fileCount: 1,
    sizeBytes: 1024,
    modifiedAt: '2024-01-01T00:00:00Z',
  },
});

const makeProject = (id: string, name: string): Project => {
  const idea = makeIdea(`idea-${id}`);
  const save = makeSave(`save-${id}`, idea.id);
  return {
    id,
    name,
    adapter: 'ableton',
    projectPath: `/projects/${id}`,
    rootIds: [],
    presence: 'active',
    watchError: null,
    lastSeenAt: '2024-01-01T00:00:00Z',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    currentIdeaId: idea.id,
    pendingOpen: null,
    driftStatus: null,
    ideas: [idea],
    saves: [save],
    watching: false,
  };
};

describe('ProjectItem keyboard support', () => {
  beforeEach(() => {
    useStore.setState({
      projects: [],
      selectedProjectId: 'proj-1',
      selectedSaveId: null,
      activeIdeaId: null,
      roots: [],
      activity: [],
      rootSuggestions: [],
      compare: null,
      previewPlayerSaveId: null,
      connected: false,
      ws: null,
      discoveredProjects: [],
    });
  });

  it('selects a project when Space is pressed on its row', () => {
    // Regression: ISSUE-002 — project rows ignored Space key activation.
    // Found by /qa on 2026-03-21
    // Report: .gstack/qa-reports/qa-report-localhost-5173-2026-03-21.md
    const project = makeProject('proj-2', 'Keyboard Project');

    const view = render(
      <TooltipProvider>
        <ProjectItem project={project} selected={false} />
      </TooltipProvider>,
    );

    const row = view.getByRole('button', { name: /Keyboard Project/i });
    row.focus();
    fireEvent.keyDown(row, { key: ' ' });

    expect(useStore.getState().selectedProjectId).toBe('proj-2');
  });
});
