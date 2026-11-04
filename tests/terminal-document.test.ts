// Synthetic native chrome only. No Electron, provider, credentials or persistent data.
import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalDocument } from '../apps/desktop/src/terminal-document.js';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';
import { terminalScriptURL, terminalStyleURL } from '../apps/desktop/src/terminal-policy.js';

function translateChrome(locale: typeof en | typeof pt, key: string) {
  const [namespace, field] = key.split('.');
  assert.ok(namespace === 'managedTerminal' || namespace === 'terminalTeam', key);
  const values = locale[namespace];
  const value = Reflect.get(values, field!);
  assert.equal(typeof value, 'string', key);
  return value as string;
}

const document = (extra: Partial<Parameters<typeof terminalDocument>[0]> = {}) =>
  terminalDocument({
    language: 'en-US',
    slot: 0,
    providers: ['Synthetic Codex', 'Synthetic Codex'],
    provider: 'Synthetic Codex',
    project: '/synthetic/project',
    version: 'SYNTHETIC-NOT-A-PROVIDER',
    startProfile: 'codex-terminal-v1',
    nativeAuthentication: true,
    scope: 'reuseScope',
    terminalId: 'synthetic-core-uuid',
    translate: (key) => translateChrome(en, key),
    ...extra,
  });

test('trusted chrome escapes project, version, provider and identity with no executable markup', () => {
  const hostile = '"><img src=x onerror="synthetic()">&';
  const html = document({
    project: hostile,
    provider: hostile,
    terminalId: hostile,
    version: hostile,
  });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes(`src="${terminalScriptURL}"`));
  assert.ok(html.includes(`href="${terminalStyleURL}"`));
  assert.match(html, /name="viewport"/);
});

test('process Stop remains outside disclosure, force stop and internal UUIDs inside', () => {
  const html = document();
  const details = html.indexOf('<details class="session-details">');
  assert.ok(html.indexOf('id="stop"') < details);
  assert.ok(html.indexOf('id="kill"') > details);
  assert.ok(html.indexOf('id="instance"') > details);
  assert.ok(html.indexOf('id="terminal-identity"') > details);
  assert.ok(html.includes(en.managedTerminal.aliasScope));
  assert.match(html, /id="lifecycle"[^>]*>Prepared; no process started/);
});

test('blocked and single-pane selections retain navigation without suggesting launch support', () => {
  const html = document({ providers: ['Synthetic Codex'], blocker: 'capacity_reserved' });
  assert.match(html, /data-blocked="true"/);
  assert.match(html, /id="split-rows" disabled/);
  assert.match(html, /id="focus-other" disabled/);
  assert.ok(!html.includes('id="tab-b"'));
  assert.ok(html.includes(en.managedTerminal.capacity_reserved));
  assert.ok(html.includes(en.managedTerminal.guide_blocked));
});

test('every emitted native chrome key exists in both shipped locales', () => {
  for (const locale of [en, pt]) {
    const translate = (key: string) => translateChrome(locale, key);
    for (const scope of ['scope', 'reuseScope', 'claudeScope', 'opencodeScope'])
      document({ translate, scope });
  }
});
