import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { electronKernelQuery } from './electron-kernel-query.js';
import type { KernelProcessIdentity } from '../../../packages/core/src/managed-codex/kernel-lifecycle-receipt.js';
import { app, WebContentsView, dialog, ipcMain, session, type BrowserWindow } from 'electron';
import { TerminalAuthority } from '../../../packages/core/src/terminal/authority.js';
import { TerminalNativeBroker } from '../../../packages/core/src/terminal/native-broker.js';
import {
  readInteractiveTerminalConfig,
  interactiveProvider,
} from '../../../packages/core/src/terminal/interactive-profile.js';
import { connectManagedTerminalCore } from './managed-terminal-core.js';
import { confirmTerminalAction } from './terminal-confirmation.js';
import { createTerminalRuntimeRouter } from './terminal-runtime.js';
import { inspectManagedTerminalFiles } from '../../../packages/core/src/terminal/managed-files.js';
import { inspectDesktopAdmission } from '../../../packages/core/src/managed-codex/desktop-admission-inspection.js';
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
import { TerminalPanels } from './terminal-panels.js';
import { terminalLayoutStore } from './terminal-layout-store.js';
import { terminalIdentity } from '../../../packages/core/src/terminal/identity.js';
import type { TerminalLayoutPreferences } from './terminal-layout.js';
import { authorizedTerminalSender } from './terminal-sender.js';
import { terminalDocument } from './terminal-document.js';
import { TerminalPreCoreFailure } from './terminal-selection.js';

/** Explicit native pair; external sessions and the observer cookie never grant execution. */
export async function createManagedTerminals(
  files: string[],
  translate: (key: string) => string,
  window: BrowserWindow,
  limit?: number,
) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.getuid?.() === 0)
    throw new Error('Managed Terminal currently requires non-root macOS arm64');
  const selection = inspectManagedTerminalFiles(files, limit);
  const keys = generateKeyPairSync('ed25519');
  const partitionId = randomUUID();
  const terminalSessions: Electron.Session[] = [];
  const router = createTerminalRuntimeRouter(ipcMain, files.length);
  let core: Awaited<ReturnType<typeof connectManagedTerminalCore>> | undefined;
  let blocker: string | undefined = selection.find((slot) => slot.blocker)?.blocker;
  let quitting = false;
  let retiring = false;
  let retired = false;
  let initialized = false;
  let panels!: TerminalPanels;
  const views: WebContentsView[] = [];
  const viewActions = new Map<
    number,
    (event: Electron.IpcMainInvokeEvent, action: unknown) => boolean
  >();
  ipcMain.handle(
    'orqst:terminal-view',
    (event, action: unknown) => viewActions.get(event.sender.id)?.(event, action) ?? false,
  );
  const openers: Array<() => void> = [];
  let effectsPossible = false;
  try {
    if (!blocker) {
      // The following Core connection may have effects; retain the existing attempt latch.
      effectsPossible = true;
      const directory = join(app.getPath('userData'), 'managed-agents');
      try {
        inspectDesktopAdmission(directory); // Passive; never claim or reconcile old reservations.
      } catch {
        blocker = 'capacity_reserved';
      }
      if (!blocker) {
        const kernel =
          process.platform === 'darwin'
            ? {
                identity: (pid: number) =>
                  electronKernelQuery(join(__dirname, 'orqst-kernel-query')).identity(pid),
                exists: (identity: KernelProcessIdentity) =>
                  electronKernelQuery(join(__dirname, 'orqst-kernel-query')).exists(identity),
              }
            : undefined;
        core = await connectManagedTerminalCore(
          files,
          join(__dirname, 'managed-terminal-core.cjs'),
          keys.publicKey,
          directory,
          limit,
          undefined,
          kernel?.identity,
          kernel?.exists,
          false,
        );
      }
    }
    let layoutStore: ReturnType<typeof terminalLayoutStore> | undefined;
    let initialLayout: TerminalLayoutPreferences | undefined;
    try {
      if (core) {
        layoutStore = terminalLayoutStore(
          app.getPath('userData'),
          selection.map(({ config }) => terminalIdentity(config).terminalId),
          core.layouts,
        );
        initialLayout = await layoutStore.load();
      }
    } catch {
      // Unavailable/corrupt preferences never change process admission.
    }
    panels = new TerminalPanels(window, {
      initial: initialLayout,
      save(state) {
        if (!layoutStore) throw new Error('Layout storage unavailable');
        return layoutStore.save(state);
      },
    });
    for (const [slot, file] of files.entries()) {
      const open = await createPane(file, slot);
      openers.push(open);
    }
    initialized = true;
  } catch (error) {
    // No broker can dispatch before the whole pair loads. Preserve all disk/admission evidence.
    router.close();
    core?.close();
    ipcMain.removeHandler('orqst:terminal-view');
    panels?.close();
    for (const terminalSession of terminalSessions)
      terminalSession.protocol.unhandle('orqst-terminal');
    if (!effectsPossible) throw new TerminalPreCoreFailure('No admission or Core entered');
    throw error;
  }
  const beforeQuit = (event: Electron.Event) => {
    if (event.defaultPrevented) return;
    quitting = true;
    router.close();
    core?.close();
    panels.close();
    ipcMain.removeHandler('orqst:terminal-view');
  };
  app.on('before-quit', beforeQuit);
  return {
    openers,
    showDashboard: () => panels.showDashboard(),
    mcpEnabled: !!selection[0]!.config.interactive?.mcp && !blocker,
    async authorizeMcp() {
      if (!core || retiring || retired) return;
      retiring = true;
      const target = window;
      const focused = views.find(
        (view, slot) =>
          panels.visible(slot) &&
          view.webContents?.isDestroyed() === false &&
          view.webContents.isFocused(),
      );
      const frame = focused?.webContents.mainFrame;
      const current = () =>
        !!target &&
        !target.isDestroyed() &&
        target.isFocused() &&
        !!focused &&
        focused.webContents?.isDestroyed() === false &&
        panels.visible(views.indexOf(focused)) &&
        focused.webContents.isFocused() &&
        focused.webContents.mainFrame === frame &&
        focused.webContents.getURL() === terminalDocumentURL;
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
      if (!core || retiring || retired) return false;
      retiring = true;
      const target = window;
      const focused = views.find(
        (view, slot) =>
          panels.visible(slot) &&
          view.webContents?.isDestroyed() === false &&
          view.webContents.isFocused(),
      );
      const frame = focused?.webContents.mainFrame;
      const current = () =>
        !target.isDestroyed() &&
        target.isFocused() &&
        !!focused &&
        focused.webContents?.isDestroyed() === false &&
        panels.visible(views.indexOf(focused)) &&
        focused.webContents.isFocused() &&
        focused.webContents.mainFrame === frame &&
        focused.webContents.getURL() === terminalDocumentURL;
      try {
        if (!current()) return false;
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
        if (result.response !== 1 || !current()) return false;
        await core.retire({
          challengeId: prepared.challenge.challengeId,
          signature: sign(
            null,
            terminalChallengeBytes(prepared.challenge),
            keys.privateKey,
          ).toString('base64url'),
        });
        // The correlated successful RPC proves signed retirement, fencing and capacity archival.
        // Any uncertain reply or cleanup below keeps the main-process selection latch closed.
        retired = true;
        initialized = false;
        viewActions.clear();
        router.close();
        ipcMain.removeHandler('orqst:terminal-view');
        const destroyed = views.map(
          ({ webContents }) =>
            new Promise<void>((resolve, reject) => {
              if (!webContents || webContents.isDestroyed()) return resolve();
              const timer = setTimeout(
                () => reject(new Error('Terminal view cleanup unconfirmed')),
                5000,
              );
              webContents.once('destroyed', () => {
                clearTimeout(timer);
                resolve();
              });
            }),
        );
        const allDestroyed = Promise.all(destroyed);
        void allDestroyed.catch(() => {}); // Cleanup refusal remains fenced even if panel close throws.
        panels.close();
        await allDestroyed;
        for (const terminalSession of terminalSessions)
          terminalSession.protocol.unhandle('orqst-terminal');
        await core.closeAndWait();
        app.removeListener('before-quit', beforeQuit);
        return true;
      } catch {
        if (target && !target.isDestroyed())
          await dialog.showMessageBox(target, {
            type: 'warning',
            message: translate('managedTerminal.retireDenied'),
            buttons: [translate('terminalNative.cancel')],
            noLink: true,
          });
        return false;
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

  async function createPane(file: string, slot: number): Promise<() => void> {
    const config = readInteractiveTerminalConfig(file);
    const provider = interactiveProvider(config);
    const providerLabel = translate(`shell.adapters.${provider}`);
    const startProfile = `${provider}-terminal-v1`;
    const authority = new TerminalAuthority(
      new Map([['desktop-managed', keys.publicKey]]),
      Date.now,
    );
    const terminalSession = session.fromPartition(`orqst-managed-terminal-${partitionId}-${slot}`, {
      cache: false,
    });
    terminalSessions.push(terminalSession);
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
      if (request.method !== 'GET') return new Response(null, { status: 405 });
      let body: string;
      let contentType: string;
      if (request.url === terminalDocumentURL) {
        body = terminalDocument({
          language: app.getLocale().toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US',
          slot,
          providers: selection.map(({ config }) =>
            translate(`shell.adapters.${interactiveProvider(config)}`),
          ),
          provider: providerLabel,
          project: config.project,
          version: config.executableVersion,
          startProfile,
          nativeAuthentication: !!config.authentication,
          scope:
            provider === 'opencode'
              ? 'opencodeScope'
              : provider === 'claude'
                ? 'claudeScope'
                : config.authentication
                  ? 'reuseScope'
                  : 'scope',
          blocker,
          terminalId: core?.identities[slot]?.terminalId,
          aliases: selection.map(({ config }) =>
            config.identity ? `P-${config.identity.terminalId}` : undefined,
          ),
          translate,
        });
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
    const view = new WebContentsView({
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
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.on('will-frame-navigate', (event) => event.preventDefault());
    view.webContents.on('will-redirect', (event) => event.preventDefault());
    view.webContents.on('will-attach-webview', (event) => event.preventDefault());
    views.push(view);
    let revoke = () => {};
    panels.add(view, () => revoke());
    if (supervisor && core)
      router.bind(
        window,
        terminalSession,
        (document, current) => {
          viewActions.set(view.webContents.id, (event, action) => {
            if (
              !initialized ||
              !authorizedTerminalSender(
                event,
                window,
                terminalSession,
                document,
                document.generation,
                true,
                view.webContents,
                panels.visible(slot),
              )
            )
              return false;
            return panels.act(slot, action);
          });
          const broker = new TerminalNativeBroker(
            authority,
            supervisor,
            'desktop-managed',
            keys.privateKey,
            document,
            {
              current: (_document, focus) => initialized && current(focus),
              confirm: (_document, details) =>
                confirmTerminalAction(dialog, window, translate, details),
            },
          );
          revoke = () => broker.revokeInput();
          return {
            dispatch: (document, request) => broker.dispatch(document, request),
            revokeInput: () => broker.revokeInput(),
            close: () => {
              broker.close();
              void core?.closeSlot(slot).catch(() => {});
            },
          };
        },
        { contents: view.webContents, visible: () => panels.visible(slot) },
      );
    // View navigation controls grant no process authority, even for a blocked manifest.
    if (!supervisor) {
      view.webContents.once('did-finish-load', () => {
        const document = { frame: view.webContents.mainFrame, generation: 0 };
        viewActions.set(view.webContents.id, (event, action) => {
          if (
            !authorizedTerminalSender(
              event,
              window,
              terminalSession,
              document,
              0,
              true,
              view.webContents,
              panels.visible(slot),
            )
          )
            return false;
          return panels.act(slot, action);
        });
      });
    }
    await view.webContents.loadURL(terminalDocumentURL);
    view.webContents.on('did-start-navigation', () => viewActions.delete(view.webContents.id));
    const contentsId = view.webContents.id;
    view.webContents.on('destroyed', () => viewActions.delete(contentsId));
    return () => {
      if (!quitting && !retired) panels.open(slot);
    };
  }
}
