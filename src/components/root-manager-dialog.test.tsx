import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/daemon-client', () => ({
  sendDaemonCommand: vi.fn(),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { RootManagerDialog } from '@/components/root-manager-dialog';
import { sendDaemonCommand } from '@/lib/daemon-client';
import { useStore } from '@/lib/store';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
});

describe('RootManagerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      projects: [],
      roots: [],
      activity: [],
      rootSuggestions: [],
      rootSuggestionsLoaded: false,
      selectedProjectId: null,
      selectedSaveId: null,
      activeIdeaId: null,
      collapsedBranches: new Set(),
      discoveredProjects: [],
      compare: null,
    });
  });

  it('does not trigger a full root sync when opened', async () => {
    render(<RootManagerDialog open onOpenChange={vi.fn()} />);

    await waitFor(() => {
      expect(sendDaemonCommand).toHaveBeenCalledWith({
        type: 'discover-root-suggestions',
      });
    });

    expect(sendDaemonCommand).not.toHaveBeenCalledWith({
      type: 'sync-roots',
    });
  });
});
