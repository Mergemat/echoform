import { join, resolve } from 'node:path';

export function resolveStateDir(
  cwd = process.cwd(),
  explicitStateDir = process.env.ABLEGIT_STATE_DIR,
): string {
  return resolve(explicitStateDir ?? join(cwd, '.ablegit-state'));
}
