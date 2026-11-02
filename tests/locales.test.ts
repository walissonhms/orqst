import { test } from 'node:test';
import assert from 'node:assert/strict';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';
function keys(value: object, prefix = ''): string[] {
  return Object.entries(value)
    .flatMap(([key, item]) =>
      typeof item === 'string' ? [prefix + key] : keys(item as object, prefix + key + '.'),
    )
    .sort();
}
test('English and Brazilian Portuguese cover the same interface strings', () => {
  assert.deepEqual(keys(pt), keys(en));
  for (const value of [en, pt]) assert.ok(keys(value).length > 100);
});
