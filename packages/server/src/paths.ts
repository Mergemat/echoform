import { join, resolve } from "node:path";

export const STATE_DIRNAME = ".echoform-state";
export const STATE_DIR_ENV = "ECHOFORM_STATE_DIR";

export function resolveStateDir(
  cwd = process.cwd(),
  explicitStateDir = process.env[STATE_DIR_ENV],
): string {
  return resolve(explicitStateDir ?? join(cwd, STATE_DIRNAME));
}
