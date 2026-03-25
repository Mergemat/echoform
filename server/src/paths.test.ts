import { describe, expect, test } from 'bun:test';
import { resolveStateDir } from './paths';

describe('resolveStateDir', () => {
  test('defaults to .ablegit-state under cwd', () => {
    expect(resolveStateDir('/tmp/ablegit-project', undefined)).toBe(
      '/tmp/ablegit-project/.ablegit-state',
    );
  });

  test('prefers explicit state directory override', () => {
    expect(
      resolveStateDir('/tmp/ablegit-project', '/Users/test/Library/App Support/Ablegit'),
    ).toBe('/Users/test/Library/App Support/Ablegit');
  });
});
