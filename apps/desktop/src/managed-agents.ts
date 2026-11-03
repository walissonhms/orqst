import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { managedAgentsReplySchema, managedAgentsRequestSchema } from '@orqst/protocol';
import {
  terminalChallengeBytes,
  type TerminalChallenge,
} from '../../../packages/core/src/terminal/authority.js';
import type { DesktopManagedAgents } from '../../../packages/core/src/managed-codex/desktop.js';
import { connectManagedAgents } from './managed-agents-core.js';
import {
  authorizedTerminalSender,
  terminalDocumentURL,
  type TerminalDocumentBinding,
} from './terminal-sender.js';
import {
  allowedTerminalRequest,
  terminalContentSecurityPolicy,
  terminalScriptURL,
  terminalStyleURL,
} from './terminal-policy.js';
import { escapeHTML } from './policy.js';

/** A native client surface over the existing structured runtime, separate from observed sessions. */
export async function createManagedAgents(translate: (key: string) => string): Promise<() => void> {
  const browserSession = session.fromPartition('orqst-structured-agents', { cache: false });
  await browserSession.setProxy({ mode: 'direct' });
  browserSession.setPermissionRequestHandler((_c, _p, done) => done(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setDevicePermissionHandler(() => false);
  browserSession.on('will-download', (event) => event.preventDefault());
  browserSession.webRequest.onBeforeRequest((d, done) =>
    done({ cancel: !allowedTerminalRequest(d.url, d.resourceType) }),
  );
  const t = (key: string) => escapeHTML(translate(`managedAgents.${key}`));
  browserSession.protocol.handle('orqst-terminal', (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    let body: string;
    let type: string;
    if (request.url === terminalDocumentURL) {
      const card = (slot: number) =>
        `<section class="pane"><h2>${t('terminal')} ${slot === 0 ? 'A' : 'B'}</h2><label>${t('model')} <input id="model-${slot}" maxlength="128" autocomplete="off"></label><nav><button id="start-${slot}">${t('start')}</button><button id="stop-${slot}" disabled>${t('stop')}</button></nav><pre id="identity-${slot}">${t('notStarted')}</pre><pre class="output" id="output-${slot}" aria-label="${t('output')}"></pre></section>`;
      body = `<!doctype html><html lang="${app.getLocale().toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US'}"><head><meta charset="utf-8"><title>${t('title')}</title><link rel="stylesheet" href="${terminalStyleURL}"></head><body><main><h1>${t('title')}</h1><p>${t('scope')}</p><p>${t('setup')}</p><p>${t('risk')}</p><p id="status" role="status" aria-live="polite" ${['ok', 'cancelled', 'busy', 'denied', 'unavailable', 'working'].map((k) => `data-${k}="${t(k)}"`).join(' ')}>${t('notStarted')}</p><p id="project"></p><div class="panes">${card(0)}${card(1)}</div><section><h2>${t('delegation')}</h2><label>${t('instructions')}<textarea id="instructions" maxlength="2048"></textarea></label><label>${t('task')}<textarea id="task" maxlength="1024"></textarea></label><button id="delegate" disabled>${t('send')}</button><p>${t('limits')}</p><pre id="communication" aria-label="${t('communication')}"></pre></section></main><script src="${terminalScriptURL}" defer></script></body></html>`;
      type = 'text/html; charset=utf-8';
    } else if (request.url === terminalScriptURL) {
      body = readFileSync(join(__dirname, 'managed-agents-client.js'), 'utf8');
      type = 'application/javascript; charset=utf-8';
    } else if (request.url === terminalStyleURL) {
      body = readFileSync(join(__dirname, 'managed-agents.css'), 'utf8');
      type = 'text/css; charset=utf-8';
    } else return new Response(null, { status: 404 });
    return new Response(body, {
      headers: {
        'Content-Type': type,
        'Content-Security-Policy': terminalContentSecurityPolicy,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
  let window: BrowserWindow | undefined;
  let core: Awaited<ReturnType<typeof connectManagedAgents>> | undefined;
  let binding: TerminalDocumentBinding | undefined;
  let generation = 0;
  let disposed = false;
  let busy = false;
  const keys = generateKeyPairSync('ed25519');
  const dispose = () => {
    disposed = true;
    generation++;
    core?.close();
  };
  ipcMain.handle('orqst:managed-agents', async (event, raw: unknown) => {
    const currentWindow = window;
    const document = binding;
    const current = (focus: boolean) =>
      !disposed &&
      !!currentWindow &&
      window === currentWindow &&
      !!document &&
      authorizedTerminalSender(event, currentWindow, browserSession, document, generation, focus);
    const parsed = managedAgentsRequestSchema.safeParse(raw);
    if (!parsed.success || !current(false)) return { status: 'denied' };
    const r = parsed.data;
    if (r.action === 'snapshot') {
      if (!core) return { status: 'ok' };
      try {
        const snapshot = await core.call({ operation: 'snapshot' });
        return current(false)
          ? managedAgentsReplySchema.parse({ status: 'ok', snapshot })
          : { status: 'denied' };
      } catch {
        return { status: 'unavailable' };
      }
    }
    if (busy) return { status: 'busy' };
    if (!current(true)) return { status: 'denied' };
    busy = true;
    try {
      if (!core) {
        if (r.action !== 'start') return { status: 'unavailable' };
        const selected = await dialog.showOpenDialog(currentWindow!, {
          title: translate('managedAgents.choose'),
          properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (selected.canceled) return { status: 'cancelled' };
        if (!current(true) || selected.filePaths.length !== 2) return { status: 'denied' };
        // Native selection only. Paths never cross the renderer boundary.
        core = await connectManagedAgents(
          [selected.filePaths[0]!, selected.filePaths[1]!],
          keys.publicKey,
          join(app.getPath('userData'), 'managed-agents'),
        );
      }
      if (!current(true)) {
        if (disposed) core.close();
        return { status: 'denied' };
      }
      let challenge: TerminalChallenge;
      let details: unknown;
      let task: ReturnType<DesktopManagedAgents['prepareTask']> | undefined;
      if (r.action === 'start') {
        const prepared = (await core.call({
          operation: 'prepareStart',
          slot: r.slot,
          model: r.model,
        })) as ReturnType<DesktopManagedAgents['prepareStart']>;
        challenge = prepared.challenge;
        details = prepared.manifest;
      } else if (r.action === 'delegate') {
        task = (await core.call({
          operation: 'prepareTask',
          text: r.text,
          task: r.task,
        })) as ReturnType<DesktopManagedAgents['prepareTask']>;
        challenge = task.challenge;
        details = task.plan;
      } else {
        challenge = (await core.call({
          operation: 'prepareStop',
          slot: r.slot,
        })) as TerminalChallenge;
        details = { signal: 'SIGTERM', challenge };
      }
      // Full exact manifest/task, with controls visible. No truncated grant or automatic signer.
      const detail = JSON.stringify(details, null, 2).replace(
        /\p{Cf}/gu,
        (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`,
      );
      // Match the existing native confirmation bound; a scrolling review surface is not implemented.
      if (detail.length > 4096 || !current(true)) return { status: 'denied' };
      const result = await dialog.showMessageBox(currentWindow!, {
        type: 'warning',
        title: translate('managedAgents.title'),
        message: translate(`managedAgents.confirm_${r.action}`),
        detail,
        buttons: [translate('terminalNative.cancel'), translate('terminalNative.confirm')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response !== 1) return { status: 'cancelled' };
      if (!current(true) || Date.now() >= challenge.expiresAt) return { status: 'denied' };
      const proof = {
        challengeId: challenge.challengeId,
        signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString(
          'base64url',
        ),
      };
      if (r.action === 'start') await core.call({ operation: 'launch', slot: r.slot, proof });
      else if (r.action === 'stop') await core.call({ operation: 'stop', slot: r.slot, proof });
      else
        await core.call({
          operation: 'runTask',
          taskId: task!.plan.taskId,
          correlationId: task!.plan.correlationId,
          proof,
        });
      if (!current(false)) return { status: 'denied' };
      return managedAgentsReplySchema.parse({
        status: 'ok',
        snapshot: await core.call({ operation: 'snapshot' }),
      });
    } catch {
      return { status: 'unavailable' };
    } finally {
      busy = false;
    }
  });
  app.once('before-quit', () => {
    dispose();
    ipcMain.removeHandler('orqst:managed-agents');
  });
  return () => {
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
      return;
    }
    if (disposed) return;
    window = new BrowserWindow({
      title: translate('managedAgents.title'),
      width: 1200,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        preload: join(__dirname, 'managed-agents-preload.cjs'),
        session: browserSession,
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
    const w = window;
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.webContents.on('will-frame-navigate', (e) => e.preventDefault());
    w.webContents.on('will-redirect', (e) => e.preventDefault());
    w.webContents.on('will-attach-webview', (e) => e.preventDefault());
    w.webContents.on('did-start-navigation', (_e, _url, _inPlace, main) => {
      if (main && binding) dispose();
    });
    w.webContents.once('did-finish-load', () => {
      binding = { frame: w.webContents.mainFrame, generation };
    });
    w.webContents.once('render-process-gone', dispose);
    w.webContents.once('destroyed', dispose);
    w.on('close', (event) => {
      if (!disposed) {
        event.preventDefault();
        w.hide();
      }
    });
    void w.loadURL(terminalDocumentURL).catch(dispose);
  };
}
