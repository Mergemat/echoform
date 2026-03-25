import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverProjectsInRoot } from './discovery';

describe('discoverProjectsInRoot', () => {
  let rootDir: string | null = null;

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
      rootDir = null;
    }
  });

  test('recursively discovers real project folders and ignores backups, hidden dirs, and AppleDouble files', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ablegit-discovery-'));

    const nestedProject = join(rootDir, 'WEST FALLIN', 'INTRO Project');
    const backupDir = join(nestedProject, 'Backup');
    const hiddenDir = join(rootDir, '.cache');
    const ignoredStateDir = join(rootDir, 'foo', '.ablegit-state');

    await mkdir(backupDir, { recursive: true });
    await mkdir(hiddenDir, { recursive: true });
    await mkdir(ignoredStateDir, { recursive: true });

    await Bun.write(join(nestedProject, 'INTRO.als'), 'intro');
    await Bun.write(join(nestedProject, '._INTRO.als'), 'ignored');
    await Bun.write(join(backupDir, 'INTRO [2026-03-25].als'), 'ignored');
    await Bun.write(join(hiddenDir, 'hidden.als'), 'ignored');
    await Bun.write(join(ignoredStateDir, 'state.als'), 'ignored');

    const discovered = await discoverProjectsInRoot(rootDir);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.path).toBe(nestedProject);
    expect(discovered[0]?.setFiles).toEqual(['INTRO.als']);
  });
});
