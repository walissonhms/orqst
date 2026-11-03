// Explicit developer acceptance application, never imported by the normal Desktop entry point.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, protocol, session } from 'electron';
import { createInstance } from 'i18next';
import en from '../../dashboard/src/locales/en-US.json';
import pt from '../../dashboard/src/locales/pt-BR.json';
import { escapeHTML } from './policy.js';
import { confirmTerminalAction } from './terminal-confirmation.js';
import { bindTerminalRuntime } from './terminal-runtime.js';
import { terminalDocumentURL } from './terminal-sender.js';
import {
  allowedTerminalRequest,
  terminalContentSecurityPolicy,
  terminalScriptURL,
  terminalStyleURL,
} from './terminal-policy.js';
import {
  TerminalAuthority,
  terminalDigest,
} from '../../../packages/core/src/terminal/authority.js';
import { TerminalNativeBroker } from '../../../packages/core/src/terminal/native-broker.js';
import { TerminalSupervisor } from '../../../packages/core/src/terminal/supervisor.js';
import { syntheticNativeBackend } from '../../../scripts/terminal/native-backend.js';

declare const __SYNTHETIC_NODE__: string;
async function start(): Promise<void> {
  assert.ok(process.argv.includes('--authorize-synthetic-pty'));
  process.umask(0o077);
  app.setName('ORQST Synthetic Terminal Lab');
  app.setPath('userData', join(__dirname, 'profile'));
  app.enableSandbox();
  protocol.registerSchemesAsPrivileged([
    { scheme: 'orqst-terminal', privileges: { standard: true, secure: true } },
  ]);
  await app.whenReady();
  const i18n = createInstance();
  await i18n.init({
    lng: app.getLocale().toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US',
    fallbackLng: 'en-US',
    resources: { 'en-US': { translation: en }, 'pt-BR': { translation: pt } },
  });
  const text = (key: string) => escapeHTML(i18n.t(`terminalLab.${key}`));
  const terminalSession = session.fromPartition('orqst-terminal-lab', { cache: false });
  await terminalSession.setProxy({ mode: 'direct' });
  terminalSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  terminalSession.setPermissionCheckHandler(() => false);
  terminalSession.setDevicePermissionHandler(() => false);
  terminalSession.on('will-download', (event) => event.preventDefault());
  terminalSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !allowedTerminalRequest(details.url, details.resourceType) }),
  );
  terminalSession.protocol.handle('orqst-terminal', (request) => {
    let body: string;
    let contentType: string;
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    if (request.url === terminalDocumentURL) {
      const button = (id: string) => `<button id="${id}">${text(id)}</button>`;
      body = `<!doctype html><html lang="${escapeHTML(i18n.language)}"><head><meta charset="utf-8"><title>${text('title')}</title><link rel="stylesheet" href="${terminalStyleURL}"></head><body><main><h1>${text('title')}</h1><p>${text('scope')}</p><p>${text('provider')}</p><div>${['start', 'attach', 'input', 'detach', 'stop'].map(button).join('')}</div><label for="paste">${text('paste')}</label><textarea id="paste" maxlength="1024"></textarea>${button('send')}<p id="status" role="status" aria-live="polite" data-denied="${text('denied')}" data-cancelled="${text('cancelled')}" data-busy="${text('busy')}" data-ok="${text('ok')}">${text('idle')}</p><pre id="output" tabindex="0" aria-label="${text('output')}"></pre></main><script src="${terminalScriptURL}" defer></script></body></html>`;
      contentType = 'text/html; charset=utf-8';
    } else if (request.url === terminalScriptURL) {
      body = readFileSync(join(__dirname, 'client.js'), 'utf8');
      contentType = 'application/javascript; charset=utf-8';
    } else if (request.url === terminalStyleURL) {
      body =
        'body{font:16px system-ui;max-width:65rem;margin:2rem auto;padding:1rem}button,textarea{font:inherit;margin:.4rem;padding:.5rem}textarea{display:block;width:95%;height:4rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid;padding:1rem;min-height:8rem}button:focus-visible,textarea:focus-visible,pre:focus-visible{outline:3px solid #155eef}';
      contentType = 'text/css; charset=utf-8';
    } else return new Response(null, { status: 404 });
    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Content-Security-Policy': terminalContentSecurityPolicy,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
  const window = new BrowserWindow({
    width: 1000,
    height: 760,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      session: terminalSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false,
      navigateOnDragDrop: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  const profile = {
    id: 'synthetic-native-v1',
    projectId: 'disposable-synthetic-lab',
    executable: __SYNTHETIC_NODE__,
    executableSha256: terminalDigest(readFileSync(__SYNTHETIC_NODE__)),
    executableVersion: 'Node 24 synthetic fixture only',
    argv: [join(__dirname, 'synthetic-fixture.mjs')],
    cwd: __dirname,
    environmentProfile: 'disposable-home-no-credentials-v1',
    permissions: 'Synthetic fixture only; 8s watchdog; no provider, sandbox or recovery claim',
  };
  let supervisor: TerminalSupervisor | undefined;
  const dispose = bindTerminalRuntime(ipcMain, window, terminalSession, (document, current) => {
    const keys = generateKeyPairSync('ed25519');
    const authority = new TerminalAuthority(new Map([['native-lab', keys.publicKey]]));
    supervisor = new TerminalSupervisor(
      authority,
      syntheticNativeBackend(__SYNTHETIC_NODE__, __dirname, profile),
      [profile],
    );
    return new TerminalNativeBroker(
      authority,
      supervisor,
      'native-lab',
      keys.privateKey,
      document,
      {
        current: (_document, focus) => current(focus),
        confirm: (_document, details) =>
          confirmTerminalAction(dialog, window, (key) => i18n.t(key), details),
      },
    );
  });
  app.on('before-quit', () => {
    dispose();
    supervisor?.shutdown();
  });
  app.on('window-all-closed', () => app.quit());
  await window.loadURL(terminalDocumentURL);
  // Acceptance-only lifetime, independent of any UI automation or IPC request.
  setTimeout(() => app.quit(), 30_000).unref();
}
void start().catch(() => app.exit(1));
