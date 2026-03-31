import { join, resolve } from "node:path";

export const STATE_DIRNAME = ".echoform-state";
export const LEGACY_STATE_DIRNAME = ".ablegit-state";
export const STATE_DIR_ENV = "ECHOFORM_STATE_DIR";
export const LEGACY_STATE_DIR_ENV = "ABLEGIT_STATE_DIR";

export function resolveStateDir(
  cwd = process.cwd(),
  explicitStateDir = process.env[STATE_DIR_ENV] ??
    process.env[LEGACY_STATE_DIR_ENV]
): string {
  return resolve(explicitStateDir ?? join(cwd, STATE_DIRNAME));
}
