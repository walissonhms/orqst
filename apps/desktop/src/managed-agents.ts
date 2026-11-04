import { managedAgentsDocument } from './managed-agents-document.js';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import {
  managedAgentsReplySchema,
  managedAgentsRequestSchema,
  type ManagedAgentsSnapshot,
} from '@orqst/protocol';
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

/** A native client surface over the existing structured runtime, separate from observed sessions. */
export async function createManagedAgents(
  translate: (key: string) => string,
  onLifetime: (state: string) => void,
): Promise<(() => void) & { confirmQuit(): boolean }> {
  const browserSession = session.fromPartition('orqst-structured-agents', { cache: false });
  await browserSession.setProxy({ mode: 'direct' });
  browserSession.setPermissionRequestHandler((_c, _p, done) => done(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setDevicePermissionHandler(() => false);
  browserSession.on('will-download', (event) => event.preventDefault());
  browserSession.webRequest.onBeforeRequest((d, done) =>
    done({ cancel: !allowedTerminalRequest(d.url, d.resourceType) }),
  );
  browserSession.protocol.handle('orqst-terminal', (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    let body: string;
    let type: string;
    if (request.url === terminalDocumentURL) {
      body = managedAgentsDocument(
        app.getLocale().toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US',
        translate,
      );
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
  let retired = false;
  let lifetime = 'idle';
  const updateLifetime = (state: string) => {
    lifetime = state;
    onLifetime(state);
    if (window && !window.isDestroyed())
      window.setTitle(
        `${translate('managedAgents.title')} — ${translate(`managedAgents.lifetime_${state}`)}`,
      );
  };
  const snapshot = async () => {
    const target = core;
    if (!target) throw new Error('No connected pair');
    const value = managedAgentsReplySchema.parse({
      status: 'ok',
      snapshot: await target.call({ operation: 'snapshot' }),
    }).snapshot!;
    if (target !== core) throw new Error('Pair changed');
    retired = value.admission === 'retired';
    updateLifetime(
      value.admission === 'unclaimed'
        ? 'idle'
        : retired
          ? 'retired'
          : value.slots.some((s) => s?.state === 'ownership_lost')
            ? 'uncertain'
            : value.slots.some((s) => s && ['starting', 'running'].includes(s.state))
              ? 'active'
              : 'reserved',
    );
    return value;
  };
  // Keep the native menu/tray current while the document is hidden; this reads metadata only.
  let sampling = false;
  const lifetimeTimer = setInterval(() => {
    if (!core || disposed || sampling) return;
    sampling = true;
    void snapshot()
      .catch(() => {
        if (!disposed && !retired) updateLifetime('uncertain');
      })
      .finally(() => {
        sampling = false;
      });
  }, 1000);
  const keys = generateKeyPairSync('ed25519');
  const dispose = () => {
    disposed = true;
    clearInterval(lifetimeTimer);
    generation++;
    if (core && !retired) updateLifetime('uncertain');
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
    const refusal = () => ({
      status: current(false) ? 'focus_required' : 'denied',
      empty: !core,
    });
    const parsed = managedAgentsRequestSchema.safeParse(raw);
    if (!parsed.success || !current(false)) return { status: 'denied' };
    const r = parsed.data;
    if (r.action === 'snapshot') {
      if (!core) return { status: 'ok', empty: true };
      try {
        const value: ManagedAgentsSnapshot = await snapshot();
        return current(false)
          ? managedAgentsReplySchema.parse({ status: 'ok', snapshot: value })
          : { status: 'denied' };
      } catch {
        updateLifetime('uncertain');
        return { status: 'unavailable' };
      }
    }
    if (busy) return { status: 'busy' };
    if (!current(true)) return refusal();
    busy = true;
    try {
      if (retired && r.action === 'start') {
        core?.close();
        core = undefined;
        retired = false;
        updateLifetime('idle');
      }
      if (!core) {
        if (r.action !== 'start') return { status: 'unavailable' };
        const selected = await dialog.showOpenDialog(currentWindow!, {
          title: translate('managedAgents.choose'),
          properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (selected.canceled) return { status: 'cancelled', empty: true };
        if (!current(true)) return refusal();
        if (selected.filePaths.length !== 2) return { status: 'denied', empty: true };
        // Native selection only. Paths never cross the renderer boundary.
        core = await connectManagedAgents(
          [selected.filePaths[0]!, selected.filePaths[1]!],
          keys.publicKey,
          join(app.getPath('userData'), 'managed-agents'),
        );
      }
      if (!current(true)) {
        if (disposed) core.close();
        return refusal();
      }
      let challenge: TerminalChallenge;
      let details: unknown;
      let task: ReturnType<DesktopManagedAgents['prepareTask']> | undefined;
      let routing: ReturnType<DesktopManagedAgents['prepareRouting']> | undefined;
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
          sourceSlot: r.sourceSlot,
        })) as ReturnType<DesktopManagedAgents['prepareTask']>;
        challenge = task.challenge;
        details = task.plan;
      } else if (r.action === 'routing') {
        routing = (await core.call({
          operation: 'prepareRouting',
          slot: r.slot,
          update: r.update,
        })) as ReturnType<DesktopManagedAgents['prepareRouting']>;
        challenge = routing.challenge;
        details = routing.plan;
      } else if (r.action === 'retire') {
        const prepared = (await core.call({ operation: 'prepareRetire' })) as ReturnType<
          DesktopManagedAgents['prepareRetire']
        >;
        challenge = prepared.challenge;
        details = prepared.evidence;
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
      if (detail.length > 4096) return { status: 'denied' };
      if (!current(true)) return refusal();
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
      if (!current(true)) return refusal();
      if (Date.now() >= challenge.expiresAt) return { status: 'denied' };
      const proof = {
        challengeId: challenge.challengeId,
        signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString(
          'base64url',
        ),
      };
      if (r.action === 'start') {
        updateLifetime('active'); // Launch admitted; completion/exit is still unconfirmed.
        await core.call({ operation: 'launch', slot: r.slot, proof });
      } else if (r.action === 'retire') await core.call({ operation: 'retire', proof });
      else if (r.action === 'stop') await core.call({ operation: 'stop', slot: r.slot, proof });
      else if (r.action === 'routing')
        await core.call({ operation: 'applyRouting', changeId: routing!.changeId, proof });
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
        snapshot: await snapshot(),
      });
    } catch {
      if (core && !retired) updateLifetime('uncertain');
      return { status: 'unavailable', empty: !core };
    } finally {
      busy = false;
    }
  });
  app.on('before-quit', (event) => {
    if (event.defaultPrevented) return;
    dispose();
    ipcMain.removeHandler('orqst:managed-agents');
  });
  const open = () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      window.webContents.focus();
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
        if (core && !retired) {
          const choice = dialog.showMessageBoxSync(w, {
            type: 'warning',
            title: translate('managedAgents.title'),
            message: translate('managedAgents.hideNotice'),
            buttons: [translate('managedAgents.stay'), translate('managedAgents.hideContinue')],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (choice !== 1) return;
        }
        updateLifetime(lifetime);
        w.hide();
      }
    });
    void w.loadURL(terminalDocumentURL).catch(dispose);
  };
  return Object.assign(open, {
    confirmQuit() {
      if (!core || retired) return true;
      return (
        dialog.showMessageBoxSync({
          type: 'warning',
          title: translate('managedAgents.title'),
          message: translate('managedAgents.quitNotice'),
          detail: translate('managedAgents.recoveryLimit'),
          buttons: [translate('terminalNative.cancel'), translate('managedAgents.disconnectQuit')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        }) === 1
      );
    },
  });
}
