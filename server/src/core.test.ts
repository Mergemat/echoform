import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AblegitService } from './core';

describe('AblegitService undo-tree restore', () => {
  let tmpRoot: string;
  let projectDir: string;
  let stateDir: string;
  let svc: AblegitService;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'ablegit-core-'));
    projectDir = join(tmpRoot, 'project');
    stateDir = join(tmpRoot, 'state');
    await mkdir(projectDir, { recursive: true });
    await Bun.write(join(projectDir, 'song.als'), 'version-1');
    svc = new AblegitService(stateDir);
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test('first save after restoring a historical save creates a new branch', async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const first = await svc.createSave(tracked.id, { label: 'Original' });
    expect(first.save).not.toBeNull();

    await writeFile(join(projectDir, 'song.als'), 'version-2');
    const second = await svc.createSave(tracked.id, { label: 'Current head' });
    expect(second.save).not.toBeNull();

    const restored = await svc.goBackTo(tracked.id, {
      saveId: first.save!.id,
    });
    expect(restored.detachedRestore?.saveId).toBe(first.save!.id);
    expect(restored.currentIdeaId).toBe(first.save!.ideaId);

    await writeFile(join(projectDir, 'song.als'), 'version-1b');
    const branched = await svc.createSave(tracked.id, {
      label: 'Recovered bass',
    });
    expect(branched.save).not.toBeNull();
    expect(branched.project.detachedRestore).toBeNull();
    expect(branched.project.ideas).toHaveLength(2);

    const mainIdea = branched.project.ideas.find(
      (idea) => idea.id === first.save!.ideaId,
    )!;
    const newIdea = branched.project.ideas.find(
      (idea) => idea.id === branched.save!.ideaId,
    )!;

    expect(mainIdea.headSaveId).toBe(second.save!.id);
    expect(newIdea.parentIdeaId).toBe(mainIdea.id);
    expect(newIdea.forkedFromSaveId).toBe(first.save!.id);
    expect(newIdea.baseSaveId).toBe(first.save!.id);
    expect(newIdea.headSaveId).toBe(branched.save!.id);
    expect(branched.project.currentIdeaId).toBe(newIdea.id);
  });

  test('restoring a branch head does not enter detached restore mode', async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const first = await svc.createSave(tracked.id, { label: 'Original' });
    expect(first.save).not.toBeNull();

    const restored = await svc.goBackTo(tracked.id, {
      saveId: first.save!.id,
    });

    expect(restored.detachedRestore).toBeNull();
    expect(restored.currentIdeaId).toBe(first.save!.ideaId);
  });

  test('can restore the main branch head after branching from an older save', async () => {
    const tracked = await svc.trackProject({ projectPath: projectDir });
    const first = await svc.createSave(tracked.id, { label: 'Original' });
    expect(first.save).not.toBeNull();

    await writeFile(join(projectDir, 'song.als'), 'version-2');
    const second = await svc.createSave(tracked.id, { label: 'Main current' });
    expect(second.save).not.toBeNull();

    const restoredPast = await svc.goBackTo(tracked.id, {
      saveId: first.save!.id,
    });
    expect(restoredPast.detachedRestore?.saveId).toBe(first.save!.id);

    await writeFile(join(projectDir, 'song.als'), 'version-1b');
    const branched = await svc.createSave(tracked.id, {
      label: 'Recovered branch',
    });
    expect(branched.save).not.toBeNull();

    const restoredMain = await svc.goBackTo(tracked.id, {
      saveId: second.save!.id,
    });
    expect(restoredMain.detachedRestore).toBeNull();
    expect(restoredMain.currentIdeaId).toBe(second.save!.ideaId);
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
