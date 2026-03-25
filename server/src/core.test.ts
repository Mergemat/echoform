import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppState, Idea, Project, Save } from './types';
import type { AbletonLauncher } from './branch-files';
import { AblegitService } from './core';

describe('AblegitService file-bound branches', () => {
  let tmpRoot: string;
  let projectDir: string;
  let stateDir: string;
  let launcher: AbletonLauncher;
  let svc: AblegitService;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'ablegit-core-'));
    projectDir = join(tmpRoot, 'project');
    stateDir = join(tmpRoot, 'state');
    await mkdir(projectDir, { recursive: true });
    await Bun.write(join(projectDir, 'song.als'), 'version-1');
    launcher = {
      openFile: mock(async () => {}),
      revealFile: mock(async () => {}),
    };
    svc = new AblegitService(stateDir, launcher);
  });

  afterEach(async () => {
    mock.restore();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test('migrates legacy project state to per-idea set paths', async () => {
    await mkdir(stateDir, { recursive: true });
    const legacyState: AppState = {
      roots: [],
      projects: [
        {
          id: 'proj-1',
          name: 'Demo',
          adapter: 'ableton',
          projectPath: projectDir,
          activeSetPath: 'song.als',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          currentIdeaId: 'idea-1',
          lastRestoredSaveId: null,
          detachedRestore: null,
          ideas: [
            {
              id: 'idea-1',
              name: 'Main',
              createdAt: '2024-01-01T00:00:00Z',
              baseSaveId: 'save-1',
              headSaveId: 'save-1',
              parentIdeaId: null,
              forkedFromSaveId: null,
            },
          ],
          saves: [
            {
              id: 'save-1',
              label: 'Initial',
              note: '',
              createdAt: '2024-01-01T00:00:00Z',
              ideaId: 'idea-1',
              previewRefs: [],
              previewStatus: 'none',
              previewMime: null,
              previewRequestedAt: null,
              previewUpdatedAt: null,
              projectHash: 'abc',
              auto: false,
              metadata: {
                activeSetPath: 'song.als',
                setFiles: ['song.als'],
                audioFiles: 0,
                fileCount: 1,
                sizeBytes: 100,
                modifiedAt: '2024-01-01T00:00:00Z',
              },
            },
          ],
          watching: true,
        } as unknown as AppState['projects'][number],
      ],
      activity: [],
    };

    await Bun.write(join(stateDir, 'state.json'), JSON.stringify(legacyState));

    const state = await svc.loadState();
    expect(state.projects[0]?.ideas[0]?.setPath).toBe('song.als');
    expect(state.projects[0]?.pendingOpen).toBeNull();
    expect(state.projects[0]?.driftStatus).toBeNull();
    expect(state.projects[0]?.rootIds).toEqual([]);
    expect(state.projects[0]?.presence).toBe('active');
    expect(state.roots).toEqual([]);
    expect(state.activity).toEqual([]);
  });

  test('migrates legacy default state into an explicit state directory', async () => {
    const previousCwd = process.cwd();
    const previousStateDir = process.env.ABLEGIT_STATE_DIR;
    process.chdir(tmpRoot);
    try {
      process.env.ABLEGIT_STATE_DIR = stateDir;
      const legacyStateDir = join(tmpRoot, '.ablegit-state');
      await mkdir(legacyStateDir, { recursive: true });

      const legacyState: AppState = {
        roots: [],
        projects: [],
        activity: [
          {
            id: 'activity-1',
            kind: 'save-created',
            message: 'Migrated',
            severity: 'info',
            createdAt: '2024-01-01T00:00:00Z',
            projectId: undefined,
            rootId: undefined,
          },
        ],
      };

      await Bun.write(
        join(legacyStateDir, 'state.json'),
        JSON.stringify(legacyState),
      );

      const migratedService = new AblegitService(stateDir, launcher);
      const state = await migratedService.loadState();

      expect(state.activity).toHaveLength(1);
      expect(state.activity[0]?.message).toBe('Migrated');
      expect(await readFile(join(stateDir, 'state.json'), 'utf8')).toContain(
        'Migrated',
      );
    } finally {
      if (typeof previousStateDir === 'string') {
        process.env.ABLEGIT_STATE_DIR = previousStateDir;
      } else {
        delete process.env.ABLEGIT_STATE_DIR;
      }
      process.chdir(previousCwd);
    }
  });

  test('syncRoots discovers nested projects under watched roots and marks missing projects', async () => {
    const rootDir = join(tmpRoot, 'roots');
    const nestedProjectDir = join(rootDir, 'album', 'nested-project');
    await mkdir(nestedProjectDir, { recursive: true });
    await Bun.write(join(nestedProjectDir, 'nested.als'), 'version-1');

    let snapshot = await svc.addRoot({ path: rootDir });
    const discovered = snapshot.projects.find(
      (project) => project.projectPath === nestedProjectDir,
    );

    expect(snapshot.roots).toHaveLength(1);
    expect(discovered).toBeTruthy();
    expect(discovered?.rootIds).toEqual([snapshot.roots[0]!.id]);
    expect(discovered?.presence).toBe('active');

    await rm(nestedProjectDir, { recursive: true, force: true });

    snapshot = await svc.syncRoots();
    const missing = snapshot.projects.find(
      (project) => project.projectPath === nestedProjectDir,
    );

    expect(missing?.presence).toBe('missing');
    expect(
      snapshot.activity.some((item) => item.kind === 'project-missing'),
    ).toBe(true);
  });

  test('branching from a save creates a new branch file and opens it', async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const first = await svc.createSave(tracked.id, { label: 'Original' });
    expect(first.save).not.toBeNull();

    const result = await svc.branchFromSave(tracked.id, {
      saveId: first.save!.id,
      name: 'Recovered bass',
      fileName: 'Recovered bass.als',
    });

    expect(result.openError).toBeUndefined();
    expect(launcher.openFile).toHaveBeenCalledTimes(1);
    const newIdea = result.project.ideas.find(
      (idea) => idea.id !== tracked.currentIdeaId,
    )!;
    expect(newIdea.name).toBe('Recovered bass');
    expect(newIdea.setPath).toBe('Recovered bass.als');
    expect(result.project.currentIdeaId).toBe(newIdea.id);
    expect(result.project.pendingOpen).toBeNull();
    expect(await readFile(join(projectDir, 'Recovered bass.als'), 'utf8')).toBe(
      'version-1',
    );
  });

  test('branch creation keeps the branch pending when Ableton open fails', async () => {
    launcher.openFile = mock(async () => {
      throw new Error('Ableton launch failed');
    });
    svc = new AblegitService(stateDir, launcher);

    const tracked = await svc.trackProject({ projectPath: projectDir });
    const first = await svc.createSave(tracked.id, { label: 'Original' });
    expect(first.save).not.toBeNull();

    const result = await svc.branchFromSave(tracked.id, {
      saveId: first.save!.id,
      name: 'Pending branch',
      fileName: 'Pending branch.als',
    });

    expect(result.openError).toContain('Ableton launch failed');
    expect(result.project.currentIdeaId).toBe(tracked.currentIdeaId);
    expect(result.project.pendingOpen?.setPath).toBe('Pending branch.als');
  });

  test('watcher attribution follows the changed branch file and autosaves it', async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const first = await svc.createSave(tracked.id, { label: 'Original' });
    expect(first.save).not.toBeNull();

    const branched = await svc.branchFromSave(tracked.id, {
      saveId: first.save!.id,
      name: 'Recovered bass',
      fileName: 'Recovered bass.als',
    });
    const branchIdea = branched.project.ideas.find(
      (idea) => idea.id === branched.project.currentIdeaId,
    )!;

    await writeFile(join(projectDir, branchIdea.setPath), 'version-1b');

    const changed = await svc.handleWatchedAlsChange(
      tracked.id,
      join(projectDir, branchIdea.setPath),
    );

    expect(changed.save).not.toBeNull();
    expect(changed.project.currentIdeaId).toBe(branchIdea.id);
    expect(changed.save?.ideaId).toBe(branchIdea.id);
    expect(changed.save?.metadata.activeSetPath).toBe(branchIdea.setPath);
  });

  test('watcher prefers the current idea when multiple .als files change together', async () => {
    await Bun.write(join(projectDir, 'song-test.als'), 'test-v1');

    const tracked = await svc.trackProject({ projectPath: projectDir });
    const songIdea = tracked.ideas.find((idea) => idea.setPath === 'song.als')!;
    await svc.openIdea(tracked.id, songIdea.id);
    await svc.createSave(tracked.id, { label: 'Original' });

    await writeFile(join(projectDir, 'song.als'), 'version-2');
    await writeFile(join(projectDir, 'song-test.als'), 'test-v2');

    const changed = await svc.handleWatchedAlsChange(tracked.id, [
      join(projectDir, 'song.als'),
      join(projectDir, 'song-test.als'),
    ]);

    expect(changed.save).not.toBeNull();
    expect(changed.project.currentIdeaId).toBe(songIdea.id);
    expect(changed.save?.metadata.activeSetPath).toBe('song.als');
    expect(changed.project.ideas).toHaveLength(2);
  });

  test('save creation keeps an idea bound to its own set file', async () => {
    await Bun.write(join(projectDir, 'song-test.als'), 'test-v1');

    const tracked = await svc.trackProject({ projectPath: projectDir });
    const songIdea = tracked.ideas.find((idea) => idea.setPath === 'song.als')!;

    await Bun.sleep(5);
    await writeFile(join(projectDir, 'song-test.als'), 'test-v2');

    const state = await svc.loadState();
    const project = state.projects.find(
      (candidate) => candidate.id === tracked.id,
    )!;
    const idea = project.ideas.find(
      (candidate) => candidate.id === songIdea.id,
    )!;

    const result = await (
      svc as unknown as {
        createSaveInState: (
          state: AppState,
          project: Project,
          idea: Idea,
          input?: { label?: string; note?: string; auto?: boolean },
          preferredSetPath?: string,
        ) => Promise<{ project: Project; save: Save | null }>;
      }
    ).createSaveInState(state, project, idea, { auto: true }, 'missing.als');

    expect(result.save).not.toBeNull();
    expect(idea.setPath).toBe('song.als');
    expect(result.save.metadata.activeSetPath).toBe('song.als');
  });

  test('autosave reuses unchanged blobs instead of rereading every project file', async () => {
    await Bun.write(join(projectDir, 'sample.wav'), 'audio-v1');

    const tracked = await svc.trackProject({ projectPath: projectDir });
    const first = await svc.createSave(tracked.id, { label: 'Original' });
    expect(first.save).not.toBeNull();

    await chmod(join(projectDir, 'sample.wav'), 0);
    await writeFile(join(projectDir, 'song.als'), 'version-2');

    const changed = await svc.handleWatchedAlsChange(
      tracked.id,
      join(projectDir, 'song.als'),
    );

    await chmod(join(projectDir, 'sample.wav'), 0o644);

    expect(changed.save).not.toBeNull();
    const latestSave = changed.save!;
    const manifestDir = join(projectDir, '.ablegit-state', 'manifests');
    const latestManifest = JSON.parse(
      await readFile(join(manifestDir, `${latestSave.id}.json`), 'utf8'),
    ) as {
      files: Array<{
        relativePath: string;
        blobHash?: string;
        mtimeMs?: number;
        type?: 'dir';
      }>;
    };

    const sampleEntry = latestManifest.files.find(
      (entry) => entry.relativePath === 'sample.wav' && entry.type !== 'dir',
    );
    expect(sampleEntry?.blobHash).toBeTruthy();
    expect(typeof sampleEntry?.mtimeMs).toBe('number');
  });

  test('requestPreview creates deterministic pending preview state', async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const created = await svc.createSave(tracked.id, { label: 'Original' });
    const save = created.save!;

    const preview = await svc.requestPreview(tracked.id, save.id);
    const state = await svc.loadState();
    const updatedSave = state.projects[0]!.saves[0]!;

    expect(preview.saveId).toBe(save.id);
    expect(preview.expectedBaseName).toBe('preview');
    expect(preview.acceptedExtensions).toEqual([
      '.wav',
      '.aif',
      '.aiff',
      '.mp3',
      '.m4a',
    ]);
    expect(preview.folderPath.endsWith(join('project', save.id))).toBe(true);
    expect(updatedSave.previewStatus).toBe('pending');
    expect(updatedSave.previewRequestedAt).toBeTruthy();
    await access(preview.folderPath);
  });

  test('ingestPendingPreviews ignores non-audio files and stays pending', async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const created = await svc.createSave(tracked.id, { label: 'Original' });
    const preview = await svc.requestPreview(tracked.id, created.save!.id);

    await writeFile(join(preview.folderPath, 'preview.txt'), 'not-a-preview');
    const changed = await svc.ingestPendingPreviews();
    const state = await svc.loadState();
    const updatedSave = state.projects[0]!.saves[0]!;

    expect(changed).toBe(false);
    expect(updatedSave.previewStatus).toBe('pending');
  });

  test('ingestPendingPreviews accepts any audio filename', async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const created = await svc.createSave(tracked.id, { label: 'Original' });
    const preview = await svc.requestPreview(tracked.id, created.save!.id);

    await writeFile(join(preview.folderPath, 'my-bounce.wav'), 'audio-data');
    expect(await svc.ingestPendingPreviews()).toBe(true);

    const state = await svc.loadState();
    const updatedSave = state.projects[0]!.saves[0]!;
    expect(updatedSave.previewStatus).toBe('ready');
    expect(updatedSave.previewMime).toBe('audio/wav');
  });

  test('ingestPendingPreviews copies previews, replaces older ones, and missing files downgrade status', async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const created = await svc.createSave(tracked.id, { label: 'Original' });
    const save = created.save!;

    const firstRequest = await svc.requestPreview(tracked.id, save.id);
    await writeFile(join(firstRequest.folderPath, 'preview.wav'), 'preview-v1');

    expect(await svc.ingestPendingPreviews()).toBe(true);

    let state = await svc.loadState();
    let updatedSave = state.projects[0]!.saves[0]!;
    const firstManagedPath = updatedSave.previewRefs[0]!;

    expect(updatedSave.previewStatus).toBe('ready');
    expect(updatedSave.previewMime).toBe('audio/wav');
    expect(await readFile(firstManagedPath, 'utf8')).toBe('preview-v1');
    expect(await svc.resolvePreviewPath(firstManagedPath)).toBe(
      firstManagedPath,
    );

    const secondRequest = await svc.requestPreview(tracked.id, save.id);
    await expect(access(firstManagedPath)).rejects.toThrow();
    await writeFile(
      join(secondRequest.folderPath, 'preview.mp3'),
      'preview-v2',
    );

    expect(await svc.ingestPendingPreviews()).toBe(true);

    state = await svc.loadState();
    updatedSave = state.projects[0]!.saves[0]!;
    const secondManagedPath = updatedSave.previewRefs[0]!;

    expect(secondManagedPath).not.toBe(firstManagedPath);
    expect(updatedSave.previewMime).toBe('audio/mpeg');
    expect(await readFile(secondManagedPath, 'utf8')).toBe('preview-v2');

    await rm(secondManagedPath, { force: true });
    await expect(svc.resolvePreviewPath(secondManagedPath)).rejects.toThrow(
      'File not found',
    );

    state = await svc.loadState();
    updatedSave = state.projects[0]!.saves[0]!;
    expect(updatedSave.previewStatus).toBe('missing');
    expect(updatedSave.previewRefs).toEqual([]);
  });

  test('tracking a project with multiple .als files creates one idea per file', async () => {
    await Bun.write(join(projectDir, 'vocals.als'), 'v-data');
    await Bun.write(join(projectDir, 'drums.als'), 'd-data');

    const tracked = await svc.trackProject({ projectPath: projectDir });

    // 3 .als files → 3 ideas (song.als, vocals.als, drums.als)
    expect(tracked.ideas).toHaveLength(3);
    const ideaNames = tracked.ideas.map((i) => i.name).sort();
    expect(ideaNames).toEqual(['drums', 'song', 'vocals']);
    // Each idea has a unique setPath pointing to its .als
    const setPaths = tracked.ideas.map((i) => i.setPath).sort();
    expect(setPaths).toEqual(['drums.als', 'song.als', 'vocals.als']);
    // currentIdeaId points to one of the ideas
    expect(tracked.ideas.some((i) => i.id === tracked.currentIdeaId)).toBe(
      true,
    );
  });

  test('watcher auto-creates an idea when an unknown .als file is changed', async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    expect(tracked.ideas).toHaveLength(1);
    expect(tracked.ideas[0]!.name).toBe('song');

    // A new .als appears in the project folder after tracking
    const newAlsPath = join(projectDir, 'remix.als');
    await Bun.write(newAlsPath, 'remix-data');

    const result = await svc.handleWatchedAlsChange(tracked.id, newAlsPath);

    // Should auto-create a new idea instead of setting drift status
    expect(result.stateChanged).toBe(true);
    expect(result.project.driftStatus).toBeNull();
    expect(result.project.ideas).toHaveLength(2);
    const newIdea = result.project.ideas.find((i) => i.name === 'remix');
    expect(newIdea).toBeTruthy();
    expect(newIdea!.setPath).toBe('remix.als');
    expect(result.project.currentIdeaId).toBe(newIdea!.id);
  });

  test('deleting a tracked project only removes it from Ablegit state', async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    await svc.createSave(tracked.id, { label: 'Original' });

    const remaining = await svc.deleteProject(tracked.id);

    expect(remaining).toHaveLength(0);
    await access(projectDir);
    await access(join(projectDir, 'song.als'));
  });
});
