import { describe, expect, it } from 'vitest';
import type { Idea, Project, Save } from '@/lib/types';
import { buildTimelineDisplayItems, getRootFileGroups } from './timeline-utils';

function makeIdea(id: string, fields: Partial<Idea> = {}): Idea {
  return {
    id,
    name: id,
    createdAt: '2024-01-01T00:00:00Z',
    setPath: 'song.als',
    baseSaveId: '',
    headSaveId: '',
    parentIdeaId: null,
    forkedFromSaveId: null,
    ...fields,
  };
}

function makeSave(id: string, ideaId: string, createdAt: string): Save {
  return {
    id,
    label: id,
    note: '',
    createdAt,
    ideaId,
    previewRefs: [],
    projectHash: id,
    auto: false,
    metadata: {
      activeSetPath: 'song.als',
      setFiles: ['song.als'],
      audioFiles: 0,
      fileCount: 1,
      sizeBytes: 100,
      modifiedAt: createdAt,
    },
  };
}

describe('buildTimelineDisplayItems', () => {
  it('inserts child branches directly after their fork save', () => {
    const mainIdea = makeIdea('idea-main', {
      name: 'Main',
      baseSaveId: 'save-1',
      headSaveId: 'save-2',
    });
    const childIdea = makeIdea('idea-child', {
      name: 'Recovered bass',
      baseSaveId: 'save-1',
      headSaveId: 'save-3',
      parentIdeaId: 'idea-main',
      forkedFromSaveId: 'save-1',
    });
    const saves = [
      makeSave('save-1', 'idea-main', '2024-01-01T00:00:00Z'),
      makeSave('save-2', 'idea-main', '2024-01-02T00:00:00Z'),
      makeSave('save-3', 'idea-child', '2024-01-03T00:00:00Z'),
    ];
    const project: Project = {
      id: 'proj-1',
      name: 'Demo',
      adapter: 'ableton',
      projectPath: '/tmp/demo',
      rootIds: [],
      presence: 'active',
      watchError: null,
      lastSeenAt: '2024-01-03T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-03T00:00:00Z',
      currentIdeaId: 'idea-child',
      pendingOpen: null,
      driftStatus: null,
      ideas: [mainIdea, childIdea],
      saves,
      watching: true,
    };

    const items = buildTimelineDisplayItems(project, null, new Set());
    expect(items.map((item) => item.type)).toEqual([
      'branch',
      'save',
      'save',
      'branch',
      'save',
    ]);

    const [rootBranch, newestMainSave, forkSave, childBranch, childSave] =
      items;
    expect(rootBranch.type === 'branch' && rootBranch.idea.id).toBe(
      'idea-main',
    );
    expect(newestMainSave.type === 'save' && newestMainSave.save.id).toBe(
      'save-2',
    );
    expect(forkSave.type === 'save' && forkSave.save.id).toBe('save-1');
    expect(childBranch.type === 'branch' && childBranch.idea.id).toBe(
      'idea-child',
    );
    expect(childBranch.type === 'branch' && childBranch.depth).toBe(1);
    expect(childSave.type === 'save' && childSave.save.id).toBe('save-3');
  });
});

describe('getRootFileGroups', () => {
  it('dedupes duplicate root ideas that point at the same set file', () => {
    const project: Project = {
      id: 'proj-1',
      name: 'Demo',
      adapter: 'ableton',
      projectPath: '/tmp/demo',
      rootIds: [],
      presence: 'active',
      watchError: null,
      lastSeenAt: '2024-01-03T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-03T00:00:00Z',
      currentIdeaId: 'idea-main',
      pendingOpen: null,
      driftStatus: null,
      ideas: [
        makeIdea('idea-main', { name: 'quick night', setPath: 'quick-night-vocal.als' }),
        makeIdea('idea-dup-1', { name: 'quick night 2', setPath: 'quick-night-vocal.als' }),
        makeIdea('idea-dup-2', { name: 'quick night 3', setPath: 'quick-night-vocal.als' }),
        makeIdea('idea-other', { name: 'quick night 4', setPath: 'quick night.als' }),
      ],
      saves: [],
      watching: true,
    };

    const groups = getRootFileGroups(project);

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.setPath === 'quick-night-vocal.als')?.rootIdeas)
      .toHaveLength(3);
    expect(groups.find((group) => group.setPath === 'quick night.als')?.rootIdeas)
      .toHaveLength(1);
  });
});
