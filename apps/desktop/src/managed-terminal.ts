import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { TerminalAuthority } from '../../../packages/core/src/terminal/authority.js';
import { TerminalNativeBroker } from '../../../packages/core/src/terminal/native-broker.js';
import { readManagedCodexConfig } from '../../../packages/core/src/terminal/codex-profile.js';
import { connectManagedTerminalCore } from './managed-terminal-core.js';
import { confirmTerminalAction } from './terminal-confirmation.js';
import { bindTerminalRuntime } from './terminal-runtime.js';
import { terminalDocumentURL } from './terminal-sender.js';
import {
  allowedTerminalRequest,
  terminalContentSecurityPolicy,
  terminalScriptURL,
  terminalStyleURL,
} from './terminal-policy.js';
import { escapeHTML } from './policy.js';

/** Explicit Desktop opt-in. No observer cookie, observed session or dashboard IPC grants access. */
export async function createManagedTerminal(
  file: string,
  translate: (key: string) => string,
): Promise<() => void> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.getuid?.() === 0)
    throw new Error('Managed Terminal currently requires non-root macOS arm64');
  const config = readManagedCodexConfig(file);
  const terminalSession = session.fromPartition('orqst-managed-terminal', { cache: false });
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
  const text = (key: string) => escapeHTML(translate(`managedTerminal.${key}`));
  terminalSession.protocol.handle('orqst-terminal', (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    let body: string;
    let contentType: string;
    if (request.url === terminalDocumentURL) {
      const button = (id: string) => `<button id="${id}">${text(id)}</button>`;
      body = `<!doctype html><html lang="${app.getLocale().toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US'}"><head><meta charset="utf-8"><title>${text('title')}</title><link rel="stylesheet" href="${terminalStyleURL}"></head><body><main><h1>${text('title')}</h1><p>${text('scope')}</p><p>${escapeHTML(config.project)} · ${escapeHTML(config.executableVersion)}</p><nav>${['login', 'start', 'attach', 'input', 'detach', 'stop', 'kill'].map(button).join('')}</nav><p id="status" role="status" aria-live="polite" ${['idle', 'denied', 'cancelled', 'busy', 'ok', 'gap', 'revoked'].map((key) => `data-${key}="${text(key)}"`).join(' ')}>${text('idle')}</p><p>${text('identity')}: <code id="instance">—</code></p><p id="lifecycle" ${['prepared', 'starting', 'running', 'exited', 'start_failed', 'ownership_lost'].map((state) => `data-${state}="${text(state)}"`).join(' ')}></p><div id="terminal" data-keyboard="${text('keyboard')}" data-toomuch="${text('tooMuch')}" aria-label="${text('output')}"></div></main><script src="${terminalScriptURL}" defer></script></body></html>`;
      contentType = 'text/html; charset=utf-8';
    } else if (request.url === terminalScriptURL) {
      body = readFileSync(join(__dirname, 'managed-terminal-client.js'), 'utf8');
      contentType = 'application/javascript; charset=utf-8';
    } else if (request.url === terminalStyleURL) {
      body = readFileSync(join(__dirname, 'managed-terminal.css'), 'utf8');
      contentType = 'text/css; charset=utf-8';
    } else return new Response(null, { status: 404 });
    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        // xterm's DOM renderer needs dynamic style rules; scripts remain local and CSP-restricted.
        'Content-Security-Policy': terminalContentSecurityPolicy.replace(
          "style-src 'self'",
          "style-src 'self' 'unsafe-inline'",
        ),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]), Date.now);
  const core = await connectManagedTerminalCore(
    file,
    join(__dirname, 'managed-terminal-core.cjs'),
    keys.publicKey,
  );
  const supervisor = core.supervisor;
  const window = new BrowserWindow({
    title: translate('managedTerminal.title'),
    width: 1100,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'terminal-preload.cjs'),
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
  const dispose = bindTerminalRuntime(ipcMain, window, terminalSession, (document, current) => {
    const broker = new TerminalNativeBroker(
      authority,
      supervisor,
      'desktop-managed',
      keys.privateKey,
      document,
      {
        current: (_document, focus) => current(focus),
        confirm: (_document, details) => confirmTerminalAction(dialog, window, translate, details),
      },
    );
    return {
      dispatch: (document, request) => broker.dispatch(document, request),
      revokeInput: () => broker.revokeInput(),
      close: () => {
        broker.close();
        core.close();
      },
    };
  });
  let quitting = false;
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  app.on('before-quit', (event) => {
    if (event.defaultPrevented) return;
    quitting = true;
    dispose();
    core.close();
  });
  await window.loadURL(terminalDocumentURL);
  return () => {
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
    }
  };
}
