import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { TerminalAuthority } from '../../../packages/core/src/terminal/authority.js';
import { TerminalNativeBroker } from '../../../packages/core/src/terminal/native-broker.js';
import { readManagedCodexConfig } from '../../../packages/core/src/terminal/codex-profile.js';
import { connectManagedTerminalCore } from './managed-terminal-core.js';
import { confirmTerminalAction } from './terminal-confirmation.js';
import { createTerminalRuntimeRouter } from './terminal-runtime.js';
import { inspectManagedTerminalFiles } from '../../../packages/core/src/terminal/managed-files.js';
import { desktopAgentsAdmission } from '../../../packages/core/src/managed-codex/desktop-admission.js';
import {
  terminalChallengeBytes,
  type TerminalChallenge,
} from '../../../packages/core/src/terminal/authority.js';
import { terminalDocumentURL } from './terminal-sender.js';
import {
  allowedTerminalRequest,
  terminalContentSecurityPolicy,
  terminalScriptURL,
  terminalStyleURL,
} from './terminal-policy.js';
import { escapeHTML } from './policy.js';

/** Explicit native pair; external sessions and the observer cookie never grant execution. */
export async function createManagedTerminals(files: string[], translate: (key: string) => string) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.getuid?.() === 0)
    throw new Error('Managed Terminal currently requires non-root macOS arm64');
  const selection = inspectManagedTerminalFiles(files);
  const keys = generateKeyPairSync('ed25519');
  const router = createTerminalRuntimeRouter(ipcMain);
  let core: Awaited<ReturnType<typeof connectManagedTerminalCore>> | undefined;
  let blocker: string | undefined = selection.find((slot) => slot.blocker)?.blocker;
  if (!blocker) {
    const directory = join(app.getPath('userData'), 'managed-agents');
    try {
      desktopAgentsAdmission(directory, files); // Inspect old markers without claiming or reconciling.
    } catch {
      blocker = 'capacity_reserved';
    }
    if (!blocker)
      core = await connectManagedTerminalCore(
        files,
        join(__dirname, 'managed-terminal-core.cjs'),
        keys.publicKey,
        directory,
      );
  }
  let quitting = false;
  let retiring = false;
  let retired = false;
  const windows: BrowserWindow[] = [];
  const openers: Array<() => void> = [];
  for (const [slot, file] of files.entries()) {
    const open = await createWindow(file, slot);
    openers.push(open);
  }
  app.on('before-quit', (event) => {
    if (event.defaultPrevented) return;
    quitting = true;
    router.close();
    core?.close();
  });
  return {
    openers,
    mcpEnabled: !!selection[0]!.config.interactive?.mcp && !blocker,
    async authorizeMcp() {
      if (!core || retiring || retired) return;
      retiring = true;
      const target = windows.find((window) => window.isFocused());
      const frame = target?.webContents.mainFrame;
      const current = () =>
        !!target &&
        !target.isDestroyed() &&
        target.isFocused() &&
        target.webContents.isFocused() &&
        target.webContents.mainFrame === frame &&
        target.webContents.getURL() === terminalDocumentURL;
      try {
        if (!current()) return;
        const prepared = (await core.prepareMcp()) as {
          challenge: TerminalChallenge;
          grant: unknown;
        };
        const detail = JSON.stringify(prepared.grant, null, 2);
        if (detail.length > 4096) throw new Error('MCP grant too large');
        const result = await dialog.showMessageBox(target!, {
          type: 'warning',
          title: translate('managedTerminal.mcpAuthorize'),
          message: translate('managedTerminal.mcpConfirm'),
          detail,
          buttons: [translate('terminalNative.cancel'), translate('terminalNative.confirm')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (result.response !== 1 || !current()) return;
        await core.authorizeMcp({
          challengeId: prepared.challenge.challengeId,
          signature: sign(
            null,
            terminalChallengeBytes(prepared.challenge),
            keys.privateKey,
          ).toString('base64url'),
        });
      } catch {
        if (target && !target.isDestroyed())
          await dialog.showMessageBox(target, {
            type: 'warning',
            message: translate('managedTerminal.mcpDenied'),
            buttons: [translate('terminalNative.cancel')],
            noLink: true,
          });
      } finally {
        retiring = false;
      }
    },
    async retire() {
      if (!core || retiring || retired) return;
      retiring = true;
      const target = windows.find((window) => window.isFocused());
      try {
        if (!target || !target.webContents.isFocused()) return;
        const prepared = (await core.prepareRetire()) as {
          challenge: TerminalChallenge;
          evidence: unknown;
        };
        const detail = JSON.stringify(prepared.evidence, null, 2);
        if (detail.length > 4096) throw new Error('Retirement evidence too large');
        const result = await dialog.showMessageBox(target, {
          type: 'warning',
          title: translate('managedTerminal.title'),
          message: translate('managedTerminal.retireConfirm'),
          detail,
          buttons: [translate('terminalNative.cancel'), translate('terminalNative.confirm')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (
          result.response !== 1 ||
          target.isDestroyed() ||
          !target.isFocused() ||
          !target.webContents.isFocused()
        )
          return;
        await core.retire({
          challengeId: prepared.challenge.challengeId,
          signature: sign(
            null,
            terminalChallengeBytes(prepared.challenge),
            keys.privateKey,
          ).toString('base64url'),
        });
        retired = true;
        router.close();
        core.close();
        for (const window of windows)
          if (!window.isDestroyed()) window.setTitle(translate('managedTerminal.retired'));
      } catch {
        if (target && !target.isDestroyed())
          await dialog.showMessageBox(target, {
            type: 'warning',
            message: translate('managedTerminal.retireDenied'),
            buttons: [translate('terminalNative.cancel')],
            noLink: true,
          });
      } finally {
        retiring = false;
      }
    },
    confirmQuit() {
      return (
        !core ||
        retired ||
        dialog.showMessageBoxSync({
          type: 'warning',
          title: translate('managedTerminal.title'),
          message: translate('managedTerminal.quitNotice'),
          buttons: [translate('terminalNative.cancel'), translate('managedAgents.disconnectQuit')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        }) === 1
      );
    },
  };

  async function createWindow(file: string, slot: number): Promise<() => void> {
    const config = readManagedCodexConfig(file);
    const authority = new TerminalAuthority(
      new Map([['desktop-managed', keys.publicKey]]),
      Date.now,
    );
    const terminalSession = session.fromPartition(`orqst-managed-terminal-${slot}`, {
      cache: false,
    });
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
        const button = (id: string) =>
          `<button id="${id}"${id === 'login' && config.authentication ? ' data-unavailable="true" disabled' : ''}>${text(id)}</button>`;
        body = `<!doctype html><html lang="${app.getLocale().toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US'}"><head><meta charset="utf-8"><title>${text('title')} ${slot === 0 ? 'A' : 'B'} · T-00${slot + 1} · Codex</title><link rel="stylesheet" href="${terminalStyleURL}"></head><body><main><h1>${text('title')} ${slot === 0 ? 'A' : 'B'} · T-00${slot + 1} · Codex</h1><p>${text(config.authentication ? 'reuseScope' : 'scope')}</p><p>${escapeHTML(config.project)} · ${escapeHTML(config.executableVersion)}</p><nav>${['login', 'start', 'attach', 'input', 'detach', 'stop', 'kill'].map(button).join('')}</nav><p id="status" data-blocked="${blocker ? 'true' : 'false'}" role="status" aria-live="polite" ${['idle', 'denied', 'cancelled', 'busy', 'ok', 'gap', 'revoked', 'focus_required'].map((key) => `data-${key}="${text(key)}"`).join(' ')}>${text(blocker ?? (config.authentication ? 'reuseIdle' : 'idle'))}</p><p>${text('terminalIdentity')}: <code id="terminal-identity">${escapeHTML(core?.identities[slot]?.terminalId ?? '—')}</code></p><p>${text('identity')}: <code id="instance">—</code></p><p id="lifecycle" ${['prepared', 'starting', 'running', 'exited', 'start_failed', 'ownership_lost'].map((state) => `data-${state}="${text(state)}"`).join(' ')}></p><div id="terminal" data-keyboard="${text('keyboard')}" data-toomuch="${text('tooMuch')}" aria-label="${text('output')}"></div></main><script src="${terminalScriptURL}" defer></script></body></html>`;
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
    const supervisor = core?.supervisors[slot];
    const window = new BrowserWindow({
      title: `${translate('managedTerminal.title')} ${slot === 0 ? 'A' : 'B'} · T-00${slot + 1} · Codex`,
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
    windows.push(window);
    if (supervisor && core)
      router.bind(window, terminalSession, (document, current) => {
        const broker = new TerminalNativeBroker(
          authority,
          supervisor,
          'desktop-managed',
          keys.privateKey,
          document,
          {
            current: (_document, focus) => current(focus),
            confirm: (_document, details) =>
              confirmTerminalAction(dialog, window, translate, details),
          },
        );
        return {
          dispatch: (document, request) => broker.dispatch(document, request),
          revokeInput: () => broker.revokeInput(),
          close: () => {
            broker.close();
            void core?.closeSlot(slot).catch(() => {});
          },
        };
      });
    window.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        window.hide();
      }
    });
    await window.loadURL(terminalDocumentURL);
    return () => {
      if (!window.isDestroyed()) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        window.webContents.focus();
      }
    };
  }
}
