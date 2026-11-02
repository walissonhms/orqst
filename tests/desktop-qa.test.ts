// Independent desktop policy/security QA. No installed DB, native sessions or GUI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  allowedNavigation,
  allowedRequest,
  bridgeOrigin,
  escapeHTML,
  offlineURL,
} from '../apps/desktop/src/policy.js';

const origin = 'http://127.0.0.1:4322';

test('desktop bridge origin is a fixed loopback IPv4 port and rejects ambiguous values', () => {
  assert.equal(bridgeOrigin(undefined), 'http://127.0.0.1:4317');
  assert.equal(bridgeOrigin('4322'), origin);
  for (const value of ['', '0', '1023', '65536', '1.5', '+4322', '-1', ' 4322', '4322 ', 'abc'])
    assert.throws(() => bridgeOrigin(value), /ORQST_DESKTOP_PORT/);
});

test('navigation accepts only root/hash or the offline scheme', () => {
  assert.equal(allowedNavigation(`${origin}/`, origin), true);
  assert.equal(allowedNavigation(`${origin}/#models`, origin), true);
  assert.equal(allowedNavigation(offlineURL, origin), true);
  for (const value of [
    `${origin}/sessions`,
    `${origin}/?x=1`,
    'http://localhost:4322/',
    'http://127.0.0.1:4317/',
    'https://example.com/',
    'file:///tmp/private',
    'javascript:alert(1)',
    'data:text/html,private',
    'http://user:pass@127.0.0.1:4322/',
    'not a url',
  ])
    assert.equal(allowedNavigation(value, origin), false, value);
});

test('requests keep assets same-origin, allow only the exact WS endpoint and deny subframes', () => {
  assert.equal(allowedRequest(`${origin}/`, origin, 'mainFrame'), true);
  assert.equal(allowedRequest(`${origin}/#models`, origin, 'mainFrame'), true);
  assert.equal(allowedRequest(`${origin}/assets/app.js`, origin, 'script'), true);
  assert.equal(allowedRequest(`${origin}/assets/app.css`, origin, 'stylesheet'), true);
  assert.equal(allowedRequest('data:image/png;base64,AA==', origin, 'image'), true);
  assert.equal(allowedRequest('ws://127.0.0.1:4322/ws', origin, 'webSocket'), true);
  assert.equal(allowedRequest(offlineURL, origin, 'mainFrame'), true);
  for (const [url, , type] of [
    [`${origin}/`, origin, 'subFrame'],
    [`${origin}/assets/app.js`, origin, 'subFrame'],
    ['data:text/html,<script>', origin, 'mainFrame'],
    ['data:image/png;base64,AA==', origin, 'script'],
    ['ws://127.0.0.1:4322/other', origin, 'webSocket'],
    ['ws://127.0.0.1:4317/ws', origin, 'webSocket'],
    ['wss://example.com/ws', origin, 'webSocket'],
    ['https://example.com/', origin, 'script'],
    ['file:///tmp/private', origin, 'script'],
    ['http://user:pass@127.0.0.1:4322/', origin, 'script'],
    ['not a url', origin, 'mainFrame'],
  ] as const)
    assert.equal(allowedRequest(url, origin, type), false, `${type} ${url}`);
});

test('offline HTML escaping covers every HTML metacharacter', () => {
  assert.equal(escapeHTML(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
  assert.equal(escapeHTML('safe text'), 'safe text');
});

test('main source enforces the Electron trust boundary and has no privileged runtime path', () => {
  const main = readFileSync(join(process.cwd(), 'apps/desktop/src/main.ts'), 'utf8');
  const webPreferences = main.slice(
    main.indexOf('webPreferences: {'),
    main.indexOf('},', main.indexOf('webPreferences: {')) + 2,
  );
  for (const required of [
    'sandbox: true',
    'contextIsolation: true',
    'nodeIntegration: false',
    'nodeIntegrationInWorker: false',
    'nodeIntegrationInSubFrames: false',
    'webviewTag: false',
    'webSecurity: true',
    'allowRunningInsecureContent: false',
    'devTools: false',
    'navigateOnDragDrop: false',
  ])
    assert.ok(webPreferences.includes(required), required);
  assert.equal(/preload\s*:/.test(webPreferences), false);
  assert.equal(/nodeIntegration\s*:\s*true/.test(main), false);
  for (const required of [
    'app.enableSandbox()',
    "session.fromPartition('orqst-desktop', { cache: false })",
    "browserSession.setProxy({ mode: 'direct' })",
    'setPermissionRequestHandler',
    'setPermissionCheckHandler',
    'setDevicePermissionHandler',
    "browserSession.on('will-download'",
    'onBeforeRequest',
    'setWindowOpenHandler',
    "on('will-navigate'",
    "on('will-frame-navigate'",
    "on('will-redirect'",
    "on('will-attach-webview'",
    'registerSchemesAsPrivileged',
    "default-src 'none'",
    'frame-ancestors',
  ])
    assert.ok(main.includes(required), required);
  for (const forbidden of [
    'child_process',
    'spawn(',
    'exec(',
    'node:sqlite',
    '@orqst/core',
    '@orqst/database',
    'shell.openExternal',
    'ipcMain',
    'ipcRenderer',
    'contextBridge',
    'nodeIntegration: true',
  ])
    assert.equal(main.includes(forbidden), false, forbidden);
});

test('desktop package is a client-only Electron dependency with no Core/DB writer', () => {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), 'apps/desktop/package.json'), 'utf8'),
  ) as {
    main: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(pkg.main, 'dist/main.cjs');
  assert.equal(pkg.devDependencies?.electron, '45.2.1');
  for (const name of ['@orqst/core', '@orqst/database', '@orqst/adapter-codex', 'better-sqlite3'])
    assert.equal(name in (pkg.dependencies ?? {}), false, name);
});
