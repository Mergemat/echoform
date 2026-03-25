import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ExpandedCard } from '@/components/expanded-card';
import { useStore } from '@/lib/store';
import type { Idea, Save } from '@/lib/types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/smart-restore-dialog', () => ({
  SmartRestoreDialog: () => null,
}));

vi.mock('@/components/preview-request-dialog', () => ({
  PreviewRequestDialog: () => null,
}));

function makeIdea(): Idea {
  return {
    id: 'idea-1',
    name: 'Main',
    createdAt: '2024-01-01T00:00:00Z',
    setPath: 'song.als',
    baseSaveId: 'save-1',
    headSaveId: 'save-1',
    parentIdeaId: null,
    forkedFromSaveId: null,
  };
}

function makeSave(status: Save['previewStatus']): Save {
  return {
    id: 'save-1',
    label: 'Initial save',
    note: '',
    createdAt: '2024-01-01T00:00:00Z',
    ideaId: 'idea-1',
    previewRefs: status === 'ready' ? ['/tmp/preview.wav'] : [],
    previewStatus: status,
    previewMime: status === 'ready' ? 'audio/wav' : null,
    previewRequestedAt: status === 'pending' ? '2024-01-01T00:00:00Z' : null,
    previewUpdatedAt: null,
    projectHash: 'hash',
    auto: false,
    metadata: {
      activeSetPath: 'song.als',
      setFiles: ['song.als'],
      audioFiles: 0,
      fileCount: 1,
      sizeBytes: 100,
      modifiedAt: '2024-01-01T00:00:00Z',
    },
  };
}

describe('ExpandedCard preview actions', () => {
  const openPreviewPlayer = vi.fn();

  beforeEach(() => {
    openPreviewPlayer.mockReset();
    useStore.setState({
      send: vi.fn(),
      openPreviewPlayer,
    });
  });

  it('shows Add preview when no preview exists', () => {
    const view = render(
      <ExpandedCard
        save={makeSave('none')}
        idea={makeIdea()}
        isHead={false}
        projectId="proj-1"
        onClose={vi.fn()}
      />,
    );

    expect(
      view.getByRole('button', { name: 'Add preview' }),
    ).toBeInTheDocument();
  });

  it('shows Add preview when preview is pending (no waiting state)', () => {
    const view = render(
      <ExpandedCard
        save={makeSave('pending')}
        idea={makeIdea()}
        isHead={false}
        projectId="proj-1"
        onClose={vi.fn()}
      />,
    );

    expect(
      view.getByRole('button', { name: 'Add preview' }),
    ).toBeInTheDocument();
  });

  it('opens the preview player when the preview is ready', () => {
    const view = render(
      <ExpandedCard
        save={makeSave('ready')}
        idea={makeIdea()}
        isHead={false}
        projectId="proj-1"
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(view.getByRole('button', { name: 'Preview' }));

    expect(openPreviewPlayer).toHaveBeenCalledWith('save-1');
  });
});
