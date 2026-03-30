import { describe, expect, test } from 'bun:test';
import { resolveStateDir } from './paths';

describe('resolveStateDir', () => {
  test('defaults to .echoform-state under cwd', () => {
    expect(resolveStateDir('/tmp/ablegit-project', undefined)).toBe(
      '/tmp/ablegit-project/.echoform-state',
    );
  });

  test('prefers explicit state directory override', () => {
    expect(
      resolveStateDir('/tmp/ablegit-project', '/Users/test/Library/Application Support/Echoform'),
    ).toBe('/Users/test/Library/Application Support/Echoform');
  });
});
