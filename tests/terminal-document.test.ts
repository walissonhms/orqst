// Synthetic native chrome only. No Electron, provider, credentials or persistent data.
import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalDocument } from '../apps/desktop/src/terminal-document.js';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';
import { terminalScriptURL, terminalStyleURL } from '../apps/desktop/src/terminal-policy.js';

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
    translate: (key) => {
      const value =
        en.managedTerminal[key.slice('managedTerminal.'.length) as keyof typeof en.managedTerminal];
      assert.equal(typeof value, 'string', key);
      return value;
    },
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

test('compact chrome keeps stop visible and advanced controls in the pane disclosure', () => {
  const html = document();
  const menu = html.indexOf('id="pane-menu"');
  const details = html.indexOf('<details class="session-details">');
  const process = html.indexOf('<section class="process-controls"');
  assert.ok(menu < details && details < process);
  const view = html.indexOf('pane-view-actions');
  const proc = html.indexOf('pane-process-actions');
  assert.ok(view > 0 && proc > view);
  assert.ok(html.indexOf('id="stop"') > proc);
  assert.ok(html.indexOf('id="kill"') > proc);
  for (const id of ['instance', 'terminal-identity', 'login']) {
    assert.ok(html.indexOf(`id="${id}"`) > details);
    assert.ok(html.indexOf(`id="${id}"`) < process);
  }
  assert.ok(html.includes(en.managedTerminal.aliasScope));
  assert.match(html, /id="lifecycle"[^>]*>Prepared/);
  assert.match(html, /id="hide-pane"[^>]*aria-label="Minimize pane/);
  assert.match(html, /id="pane-menu-toggle"[^>]*aria-expanded="false"/);
  assert.ok(html.includes('T-001')); // Existing selection-local alias, qualified in details.
  assert.ok(!html.includes('<select id="model'));
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
    const translate = (key: string) => {
      const value =
        locale.managedTerminal[
          key.slice('managedTerminal.'.length) as keyof typeof locale.managedTerminal
        ];
      assert.equal(typeof value, 'string', key);
      return value;
    };
    for (const scope of ['scope', 'reuseScope', 'claudeScope', 'opencodeScope'])
      document({ translate, scope });
  }
});

test('only explicitly selected terminal documents opt into operational Open; legacy Start is unchanged', () => {
  const legacy = document();
  const selected = document({ operationalOpen: true });
  assert.ok(!legacy.includes('data-operational-open="true"'));
  assert.ok(legacy.includes(`id="start">${en.managedTerminal.start}</button>`));
  assert.ok(selected.includes('data-operational-open="true"'));
  assert.ok(selected.includes(`id="start">${en.managedTerminal.open}</button>`));
  assert.ok(selected.includes(en.managedTerminal.openingIncomplete));
  assert.ok(selected.includes(en.managedTerminal.guide_openingIncomplete));
});
