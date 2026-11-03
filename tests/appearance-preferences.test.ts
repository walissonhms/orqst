import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultAppearancePreferences,
  parseAppearancePreferences,
} from '../apps/dashboard/src/appearance-preferences.js';

test('appearance storage admits only supported choices and never captured content or control options', () => {
  for (const value of [null, 'invalid', 'null', '[]', '42', '"dark"'])
    assert.deepEqual(parseAppearancePreferences(value), defaultAppearancePreferences);
  assert.deepEqual(
    parseAppearancePreferences(
      JSON.stringify({ contrast: 'light', density: 42, motion: 'always' }),
    ),
    defaultAppearancePreferences,
  );
  assert.deepEqual(
    parseAppearancePreferences(
      JSON.stringify({
        contrast: 'high',
        density: 'comfortable',
        motion: 'reduced',
        sessionContent: 'synthetic content must be discarded',
        run: true,
      }),
    ),
    { contrast: 'high', density: 'comfortable', motion: 'reduced' },
  );
  assert.deepEqual(parseAppearancePreferences(JSON.stringify({ density: 'comfortable' })), {
    ...defaultAppearancePreferences,
    density: 'comfortable',
  });
});
