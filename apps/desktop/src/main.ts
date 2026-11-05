import './diagnostic-output.js';
import { terminalSlotLimit, TERMINAL_SLOT_CEILING } from '@orqst/protocol';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  protocol,
  session,
  shell,
  Tray,
} from 'electron';
import { join } from 'node:path';
import { ArtifactSaver, readSaveOriginal } from './artifacts.js';
import { AnalyticsSaver, readNativeAnalytics } from './analytics.js';
import { createManagedTerminals } from './managed-terminal.js';
import { createManagedAgents } from './managed-agents.js';
import { TerminalSelection } from './terminal-selection.js';
import { prepareTerminalCreation } from './terminal-creation.js';
import {
  authorizeCliCandidates,
  cliBindingsCurrent,
  revalidateCliBindings,
} from '../../../packages/core/src/terminal/cli-authorization-flow.js';
import { TerminalCliPolicyStore } from '../../../packages/core/src/terminal/cli-authorization.js';
import { systemCliSignatureVerifier } from '../../../packages/core/src/terminal/cli-system-signature.js';
import { cliAuthorizationScope } from '../../../packages/core/src/terminal/cli-authorization-scope.js';
import { terminalDigest } from '../../../packages/core/src/terminal/authority.js';
import { inspectDesktopAdmission } from '../../../packages/core/src/managed-codex/desktop-admission-inspection.js';

import { discoverTerminalExecutable, discoverTerminalNode } from './terminal-discovery.js';
import { studioRequestSchema, type StudioSnapshot } from '@orqst/protocol';
import { TerminalPreCoreFailure } from './terminal-selection.js';
import type { LocalCliProvider } from '../../../packages/core/src/terminal/local-cli.js';
import { analyticsNativeRequestSchema } from '@orqst/protocol';
import { authorizedArtifactSender } from './artifact-sender.js';
import { DesktopMonitor, readMonitorSnapshot, type NativeAlert } from './monitor.js';
import { createInstance } from 'i18next';
import en from '../../dashboard/src/locales/en-US.json';
import pt from '../../dashboard/src/locales/pt-BR.json';
import {
  allowedNavigation,
  allowedRequest,
  bridgeOrigin,
  escapeHTML,
  offlineURL,
} from './policy.js';

process.umask(0o077);
app.setName('ORQST');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  { scheme: 'orqst-desktop', privileges: { standard: true, secure: true } },
  { scheme: 'orqst-terminal', privileges: { standard: true, secure: true } },
]);
const origin = bridgeOrigin(process.env.ORQST_DESKTOP_PORT);
let window: BrowserWindow | undefined;
const ownsInstance = app.requestSingleInstanceLock();

async function start(): Promise<void> {
  await app.whenReady();
  const iconsDirectory = join(__dirname, 'icons');
  const applicationIcon = nativeImage.createFromPath(
    join(iconsDirectory, process.platform === 'win32' ? 'orqst.ico' : 'orqst-512.png'),
  );
  if (applicationIcon.isEmpty()) throw new Error('Missing ORQST application icon');
  app.dock?.setIcon(applicationIcon);
  const i18n = createInstance();
  await i18n.init({
    lng: app.getLocale().toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US',
    fallbackLng: 'en-US',
    resources: { 'en-US': { translation: en }, 'pt-BR': { translation: pt } },
  });
  // In-memory browser state: no captured content or cookies persisted by this client.
  const browserSession = session.fromPartition('orqst-desktop', { cache: false });
  browserSession.setUserAgent(`${browserSession.getUserAgent()} ORQSTDesktop/0.1`);
  await browserSession.setProxy({ mode: 'direct' });
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setDevicePermissionHandler(() => false);
  browserSession.on('will-download', (event) => event.preventDefault());
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !allowedRequest(details.url, origin, details.resourceType) });
  });
  browserSession.protocol.handle('orqst-desktop', (request) => {
    if (request.url !== offlineURL) return new Response(null, { status: 404 });
    const text = (key: string) => escapeHTML(i18n.t(`desktopShell.${key}`));
    return new Response(
      `<!doctype html><html lang="${escapeHTML(i18n.language)}"><meta charset="utf-8"><title>ORQST</title><main><h1>${text('unavailable')}</h1><p>${text('retry')}</p><p>${text('lifetime')}</p><p>${escapeHTML(origin)}</p></main></html>`,
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy':
            "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  });
  const terminalConfigs = process.argv
    .filter((value) => value.startsWith('--terminal-config='))
    .map((value) => value.slice('--terminal-config='.length));
  const configuredLimit = process.env.ORQST_TERMINAL_LIMIT;
  if (configuredLimit !== undefined && !/^[1-9]\d*$/.test(configuredLimit))
    throw new Error(
      `ORQST_TERMINAL_LIMIT must be an integer from 1 through ${TERMINAL_SLOT_CEILING}`,
    );
  const terminalLimit = terminalSlotLimit(
    configuredLimit === undefined ? undefined : Number(configuredLimit),
  );
  const terminalMenuId = (slot: number) =>
    slot === 0
      ? 'managed-terminal-open'
      : slot === 1
        ? 'managed-terminal-b-open'
        : `managed-terminal-${slot}-open`;
  let terminals: Awaited<ReturnType<typeof createManagedTerminals>> | undefined;
  let terminalSelection = new TerminalSelection(Date.now, terminalLimit);
  let terminalOpening = false;
  let managedLifetime = 'idle';
  let refreshManagedTray: () => void = () => undefined;
  const openManagedAgents = await createManagedAgents(
    (key) => i18n.t(key),
    (state) => {
      managedLifetime = state;
      const item = Menu.getApplicationMenu()?.getMenuItemById('managed-agents-open');
      if (item)
        item.label = `${i18n.t('managedAgents.title')} — ${i18n.t(`managedAgents.lifetime_${state}`)}`;
      refreshManagedTray?.();
    },
  );
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: i18n.t('managedTerminal.title'),
        submenu: [
          {
            id: 'managed-terminal-create',
            label: i18n.t(
              terminalLimit === 1 ? 'managedTerminal.createTeam' : 'managedTerminal.createPair',
            ),
            click: () => void createTerminalSelection(),
          },
          ...(terminalLimit > 2
            ? [
                {
                  label: i18n.t('managedTerminal.createTeam'),
                  submenu: Array.from({ length: terminalLimit }, (_, slot) => ({
                    id: `managed-terminal-create-${slot + 1}`,
                    label: i18n.t('managedTerminal.createCount', { count: slot + 1 }),
                    click: () => void createTerminalSelection(slot + 1),
                  })),
                },
              ]
            : []),
          {
            id: 'managed-terminal-select',
            label: i18n.t('managedTerminal.selectManifests'),
            enabled: !terminals,
            click: () => void reviewTerminalSelection(),
          },
          {
            id: 'managed-agents-open',
            label: i18n.t('managedAgents.title'),
            click: openManagedAgents,
          },
          ...Array.from({ length: terminalLimit }, (_, slot) => ({
            id: terminalMenuId(slot),
            label: `${i18n.t('managedTerminal.open')} ${String.fromCharCode(65 + slot)}`,
            enabled: !!terminals?.openers[slot],
            click: () => void openTerminalSelection(slot),
          })),
          {
            id: 'managed-terminal-dashboard',
            label: i18n.t('managedTerminal.dashboard'),
            enabled: !!terminals,
            accelerator: 'CmdOrCtrl+Shift+O',
            click: () => terminals?.showDashboard(),
          },
          {
            id: 'managed-terminal-mcp',
            label: i18n.t('managedTerminal.mcpAuthorize'),
            enabled: !!terminals?.mcpEnabled,
            click: () => void terminals?.authorizeMcp(),
          },
          {
            id: 'managed-terminal-retire',
            label: i18n.t('managedTerminal.retire'),
            enabled: !!terminals,
            click: () => void retireTerminalSelection(),
          },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );

  const saver = new ArtifactSaver();
  const analyticsSaver = new AnalyticsSaver();
  let nativeFileBusy = false;
  let documentGeneration = 0;
  let quitting = false;
  let terminalCreationAttempted = false;
  let terminalCreationCompleted = false;
  let createdTerminalFiles: string[] | undefined;

  function updateTerminalMenu(): void {
    const menu = Menu.getApplicationMenu();
    const select = menu?.getMenuItemById('managed-terminal-select');
    if (select) select.enabled = !terminals && !terminalSelection.locked && !terminalOpening;
    const create = menu?.getMenuItemById('managed-terminal-create');
    if (create)
      create.enabled =
        !terminals && !terminalSelection.locked && !terminalOpening && !terminalCreationAttempted;
    for (let slot = 0; slot < terminalLimit; slot++) {
      const item = menu?.getMenuItemById(terminalMenuId(slot));
      if (item)
        item.enabled =
          !terminalOpening &&
          (!!terminals?.openers[slot] ||
            (!terminalSelection.locked && slot < terminalSelection.count));
    }
    for (let count = 1; count <= terminalLimit; count++) {
      const item = menu?.getMenuItemById(`managed-terminal-create-${count}`);
      if (item) item.enabled = !!create?.enabled;
    }
    const dashboard = menu?.getMenuItemById('managed-terminal-dashboard');
    if (dashboard) dashboard.enabled = !!terminals;
    const mcp = menu?.getMenuItemById('managed-terminal-mcp');
    if (mcp) mcp.enabled = !!terminals?.mcpEnabled;
    const retire = menu?.getMenuItemById('managed-terminal-retire');
    if (retire) retire.enabled = !!terminals && !terminalOpening && !nativeFileBusy;
  }

  async function retireTerminalSelection(): Promise<void> {
    const active = terminals;
    if (!active || terminalOpening || nativeFileBusy) return;
    terminalOpening = true;
    nativeFileBusy = true;
    updateTerminalMenu();
    try {
      if (!(await active.retire()) || terminals !== active || quitting) return;
      // Fresh review is possible only after signed Core retirement and complete old-surface cleanup.
      terminals = undefined;
      terminalSelection = new TerminalSelection(Date.now, terminalLimit);
      terminalCreationAttempted = false;
      terminalCreationCompleted = false;
      createdTerminalFiles = undefined;
    } finally {
      terminalOpening = false;
      nativeFileBusy = false;
      updateTerminalMenu();
    }
  }

  // Both entry points use the same native review; renderer arguments never supply paths or grants.
  function terminalSelectionContext() {
    const target = window;
    const frame = target && !target.isDestroyed() ? target.webContents.mainFrame : undefined;
    const generation = documentGeneration;
    let invalidated = false;
    const invalidate = () => {
      invalidated = true;
    };
    target?.on('blur', invalidate);
    const current = () => {
      try {
        return (
          !invalidated &&
          !quitting &&
          !!target &&
          window === target &&
          !target.isDestroyed() &&
          !target.webContents.isDestroyed() &&
          target.webContents.session === browserSession &&
          frame === target.webContents.mainFrame &&
          !!frame &&
          !frame.detached &&
          !frame.isDestroyed() &&
          generation === documentGeneration &&
          frame.url === target.webContents.getURL() &&
          allowedNavigation(frame.url, origin) &&
          target.isFocused() &&
          target.webContents.isFocused()
        );
      } catch {
        return false;
      }
    };
    return { target, current, dispose: () => target?.removeListener('blur', invalidate) };
  }

  async function explainTerminalFocus(target: BrowserWindow | undefined): Promise<void> {
    if (!target || target.isDestroyed() || !target.isVisible()) return;
    await dialog.showMessageBox(target, {
      type: 'warning',
      message: i18n.t('managedTerminal.selectionFocusRequired'),
      buttons: [i18n.t('terminalNative.cancel')],
      noLink: true,
    });
  }

  async function createTerminalSelection(
    count = Math.min(2, terminalLimit),
    mixed = false,
  ): Promise<void> {
    if (
      terminals ||
      terminalOpening ||
      terminalSelection.locked ||
      nativeFileBusy ||
      terminalCreationAttempted
    )
      return;
    const context = terminalSelectionContext();
    if (!context.current()) {
      await explainTerminalFocus(context.target);
      context.dispose();
      return;
    }
    nativeFileBusy = true;
    const expires = Date.now() + 300000;
    const current = () => Date.now() < expires && context.current();
    let files: string[] | undefined;
    try {
      const providers =
        count === 2
          ? (['codex', 'claude', 'opencode', 'codexOpenCode'] as const)
          : (['codex', 'claude', 'opencode'] as const);
      const providerResult = mixed
        ? { response: 4 }
        : await dialog.showMessageBox(context.target!, {
            title: i18n.t(
              count === 2 ? 'managedTerminal.createPair' : 'managedTerminal.createTeam',
            ),
            message: i18n.t('managedTerminal.createProvider'),
            buttons: [
              i18n.t('terminalNative.cancel'),
              ...providers.map((provider) => i18n.t(`managedTerminal.createProvider_${provider}`)),
            ],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
      const choice = providers[providerResult.response - 1];
      if (!current() || !choice) return;
      const provider: LocalCliProvider = choice === 'codexOpenCode' ? 'codex' : choice;
      const choose = async (key: string, directory = false) => {
        if (!current()) return undefined;
        const result = await dialog.showOpenDialog(context.target!, {
          title: i18n.t(`managedTerminal.${key}`),
          properties: [
            directory ? 'openDirectory' : 'openFile',
            'dontAddToRecent',
            'noResolveAliases',
          ],
        });
        return current() && !result.canceled && result.filePaths.length === 1
          ? result.filePaths[0]
          : undefined;
      };
      const home = process.env.HOME ?? app.getPath('home');
      const searchPath = process.env.PATH ?? '';
      const candidate = async (name: string, paths: string[], fallback: string) => {
        if (!current()) return undefined;
        // Even a single passive candidate is shown in the full final path/hash review.
        if (paths.length === 1) return paths[0];
        const detail = paths
          .map((path, index) => `${index + 1}. ${path}`)
          .join('\n')
          .replace(/\p{Cf}/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);
        if (detail.length > 4096) throw new Error('Candidate review exceeds native display limit');
        const result = await dialog.showMessageBox(context.target!, {
          detail,
          title: i18n.t('managedTerminal.discoverTitle', { provider: name }),
          message: i18n.t(
            paths.length ? 'managedTerminal.discoverChoose' : 'managedTerminal.discoverMissing',
          ),
          buttons: [
            i18n.t('terminalNative.cancel'),
            i18n.t('managedTerminal.discoverManual'),
            ...paths.map((_path, index) =>
              i18n.t('managedTerminal.discoverCandidate', { number: index + 1 }),
            ),
          ],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (!current() || !result.response) return undefined;
        return result.response === 1 ? choose(fallback) : paths[result.response - 2];
      };
      const executable = await candidate(
        provider,
        discoverTerminalExecutable(provider, searchPath, home),
        'createExecutable',
      );
      if (!executable) return;
      const companionExecutable =
        choice === 'codexOpenCode'
          ? await candidate(
              'OpenCode',
              discoverTerminalExecutable('opencode', searchPath, home),
              'createExecutable',
            )
          : undefined;
      if (choice === 'codexOpenCode' && !companionExecutable) return;
      const node = await candidate('Node', discoverTerminalNode(searchPath, home), 'createNode');
      if (!node) return;
      const project = await choose('createProject', true);
      if (!project) return;
      const mcpResult =
        count !== 2
          ? { response: 1 }
          : await dialog.showMessageBox(context.target!, {
              title: i18n.t(
                count === 2 ? 'managedTerminal.createPair' : 'managedTerminal.createTeam',
              ),
              message: i18n.t(`managedTerminal.createMcp_${choice}`),
              buttons: [
                i18n.t('terminalNative.cancel'),
                i18n.t('managedTerminal.createWithoutMcp'),
                i18n.t('managedTerminal.createWithMcp'),
              ],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            });
      if (!current() || ![1, 2].includes(mcpResult.response)) return;
      const policyDirectory = join(app.getPath('userData'), 'managed-agents');
      inspectDesktopAdmission(policyDirectory);
      const policy = new TerminalCliPolicyStore(policyDirectory);
      const mode = mcpResult.response === 2 ? ('mcp' as const) : ('tui' as const);
      const candidates = [
        { provider, executable },
        ...(companionExecutable
          ? [{ provider: 'opencode' as const, executable: companionExecutable }]
          : []),
      ];
      const inputs = candidates.map((item) => ({
        store: policy,
        provider: item.provider,
        mode,
        executable: item.executable,
        verifier: systemCliSignatureVerifier,
        profile: (version: string, sha256: string) => ({
          id: `${item.provider}-terminal-v1`,
          projectId: terminalDigest(project),
          executable: item.executable,
          executableSha256: sha256,
          executableVersion: version,
          argv: [],
          cwd: project,
          permissions: 'Native owned terminal CLI authorization',
          ...cliAuthorizationScope(item.provider, mode),
        }),
      }));
      const results = await authorizeCliCandidates(
        inputs,
        async (details, existing) => {
          const detail = JSON.stringify(
            {
              candidates: [...details, ...existing],
              versionEvidence: 'not yet probed',
              signatureEvidence: 'macOS /usr/bin/codesign',
            },
            null,
            2,
          ).replace(/\p{Cf}/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);
          if (!current() || detail.length > 16384) return false;
          const answer = await dialog.showMessageBox(context.target!, {
            type: 'warning',
            title: i18n.t('terminalNative.title'),
            message: `${i18n.t('terminalNative.cliScope')}\n\n${i18n.t('terminalNative.cliProbeDisclosure')}`,
            detail,
            buttons: [i18n.t('terminalNative.cancel'), i18n.t('terminalNative.authorizeCli')],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          return answer.response === 1 && current();
        },
        async () => current(),
      );
      if (results.some((result) => result.status !== 'allowed') || !current()) return;
      const authorizedCli = results.flatMap((result, index) =>
        result.status === 'allowed' ? [{ input: inputs[index]!, allowed: result }] : [],
      );
      const cliEvidence = results.flatMap((result) =>
        result.status === 'allowed'
          ? [
              {
                executable: result.profile.executable,
                version: result.profile.executableVersion,
                sha256: result.profile.executableSha256,
                binding: result.binding,
              },
            ]
          : [],
      );
      const creationInput = {
        cliEvidence,
        count,
        limit: terminalLimit,
        provider,
        executable,
        ...(companionExecutable
          ? { companion: { provider: 'opencode' as const, executable: companionExecutable } }
          : {}),
        node,
        project,
        parent: app.getPath('userData'),
        home: process.env.HOME ?? app.getPath('home'),
        environment: process.env,
        mcp: mcpResult.response === 2,
      };
      let plan = prepareTerminalCreation(creationInput);
      let openCodeStartupAuthorized = false;
      let startupChoice: number | undefined;
      if (provider === 'opencode' || choice === 'codexOpenCode') {
        for (const detail of plan.pages) {
          const consent = await dialog.showMessageBox(context.target!, {
            type: 'warning',
            title: i18n.t(
              count === 2 ? 'managedTerminal.createPair' : 'managedTerminal.createTeam',
            ),
            message: i18n.t('managedTerminal.openCodeStartupReview'),
            detail,
            checkboxLabel: i18n.t('managedTerminal.openCodeStartupAcknowledgment'),
            checkboxChecked: false,
            buttons: [
              i18n.t('terminalNative.cancel'),
              i18n.t('managedTerminal.openCodeKeepBlocked'),
              i18n.t('managedTerminal.openCodeAuthorizeStartup'),
            ],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (!current() || ![1, 2].includes(consent.response)) return;
          if (consent.response === 2 && !consent.checkboxChecked) return;
          if (startupChoice !== undefined && consent.response !== startupChoice) return;
          startupChoice = consent.response;
          openCodeStartupAuthorized = consent.response === 2;
        }
        if (openCodeStartupAuthorized)
          plan = prepareTerminalCreation({ ...creationInput, openCodeStartupAuthorized: true });
      }
      const reviewExpires = Date.now() + 60000;
      const reviewed = () => current() && Date.now() < reviewExpires;
      for (const detail of plan.pages) {
        const result = await dialog.showMessageBox(context.target!, {
          type: 'warning',
          title: i18n.t(count === 2 ? 'managedTerminal.createPair' : 'managedTerminal.createTeam'),
          message: i18n.t(
            openCodeStartupAuthorized
              ? 'managedTerminal.createOpenCodeAuthorizedReview'
              : 'managedTerminal.createReview',
          ),
          detail,
          checkboxLabel: i18n.t('managedTerminal.createAcknowledgment'),
          checkboxChecked: false,
          buttons: [i18n.t('terminalNative.cancel'), i18n.t('managedTerminal.createFiles')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (!reviewed() || result.response !== 1 || !result.checkboxChecked) return;
      }
      if (!(await revalidateCliBindings(authorizedCli, async () => reviewed()))) return;
      if (!reviewed() || !cliBindingsCurrent(authorizedCli)) return;
      terminalCreationAttempted = true;
      files = plan.provision(() => reviewed() && cliBindingsCurrent(authorizedCli));
      terminalCreationCompleted = true;
      createdTerminalFiles = files;
    } catch {
      if (context.current())
        await dialog.showMessageBox(context.target!, {
          type: 'warning',
          message: i18n.t('managedTerminal.creationDenied'),
          buttons: [i18n.t('terminalNative.cancel')],
          noLink: true,
        });
    } finally {
      context.dispose();
      nativeFileBusy = false;
      updateTerminalMenu();
    }
    // New transaction: registration remains the existing complete native review, with its own TTL.
    if (files) await reviewTerminalSelection(files);
  }

  async function reviewTerminalSelection(createdFiles?: string[]): Promise<void> {
    if (terminals || terminalOpening || terminalSelection.locked || nativeFileBusy) return;
    const context = terminalSelectionContext();
    if (!context.current()) {
      await explainTerminalFocus(context.target);
      context.dispose();
      return;
    }
    nativeFileBusy = true;
    try {
      const result = await terminalSelection.review({
        current: context.current,
        choose: async () => {
          if (createdFiles) return createdFiles;
          const result = await dialog.showOpenDialog(context.target!, {
            title: i18n.t('managedTerminal.selectManifests'),
            message: i18n.t('managedTerminal.chooseManifests'),
            filters: [{ name: 'JSON', extensions: ['json'] }],
            properties: ['openFile', 'multiSelections', 'dontAddToRecent', 'noResolveAliases'],
          });
          return result.canceled ? undefined : result.filePaths;
        },
        confirm: async (detail) => {
          const result = await dialog.showMessageBox(context.target!, {
            type: 'warning',
            title: i18n.t('managedTerminal.selectManifests'),
            message: i18n.t('managedTerminal.reviewManifests'),
            detail,
            buttons: [i18n.t('terminalNative.cancel'), i18n.t('managedTerminal.keepSelection')],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          return result.response === 1;
        },
      });
      if ((result === 'denied' || result === 'launch_unavailable') && context.current())
        await dialog.showMessageBox(context.target!, {
          type: 'warning',
          message: i18n.t(
            result === 'launch_unavailable'
              ? 'managedTerminal.launch_unavailable'
              : 'managedTerminal.selectionDenied',
          ),
          buttons: [i18n.t('terminalNative.cancel')],
          noLink: true,
        });
    } finally {
      context.dispose();
      nativeFileBusy = false;
      updateTerminalMenu();
    }
  }

  async function openTerminalSelection(slot: number): Promise<void> {
    if (terminals) {
      terminals.openers[slot]?.();
      return;
    }
    if (terminalOpening || nativeFileBusy || slot >= terminalSelection.count) return;
    const context = terminalSelectionContext();
    if (!context.current()) {
      await explainTerminalFocus(context.target);
      context.dispose();
      return;
    }
    terminalOpening = true;
    nativeFileBusy = true;
    updateTerminalMenu();
    try {
      const files = terminalSelection.take();
      terminals = await createManagedTerminals(files, (key) => i18n.t(key), window!, terminalLimit);
      if (context.current()) terminals.openers[slot]?.();
    } catch (error) {
      if (error instanceof TerminalPreCoreFailure) {
        terminalSelection.retryBeforeCore(error);
        if (terminalCreationCompleted) {
          terminalCreationAttempted = false;
          terminalCreationCompleted = false;
        }
      }
      if (context.current())
        await dialog.showMessageBox(context.target!, {
          type: 'warning',
          message: i18n.t(
            error instanceof TerminalPreCoreFailure
              ? 'managedTerminal.selectionRetryReady'
              : 'managedTerminal.selectionOpenDenied',
          ),
          buttons: [i18n.t('terminalNative.cancel')],
          noLink: true,
        });
    } finally {
      context.dispose();
      terminalOpening = false;
      nativeFileBusy = false;
      updateTerminalMenu();
    }
  }
  function studioSnapshot(): StudioSnapshot {
    return {
      count: terminals?.openers.length ?? terminalSelection.count,
      limit: terminalLimit,
      opened: !!terminals,
      prepared: !!createdTerminalFiles,
      canCreate: !terminals && !terminalSelection.locked && !terminalCreationAttempted,
      canSelect: !terminals && !terminalSelection.locked,
      busy: nativeFileBusy || terminalOpening,
    };
  }
  ipcMain.handle('orqst:studio', async (event, raw: unknown) => {
    const request = studioRequestSchema.safeParse(raw);
    if (
      !request.success ||
      quitting ||
      !window ||
      !authorizedArtifactSender(event, window.webContents, browserSession, origin)
    )
      return { status: 'denied' };
    const { action } = request.data;
    if (action === 'snapshot') return { status: 'ok', snapshot: studioSnapshot() };
    if (!window.isFocused() || !window.webContents.isFocused()) return { status: 'focus_required' };
    if (nativeFileBusy || terminalOpening) return { status: 'busy' };
    const state = studioSnapshot();
    if (action === 'createMixed') {
      if (!state.canCreate || terminalLimit < 2) return { status: 'denied' };
      await createTerminalSelection(2, true);
    } else if (action === 'create') {
      if (!state.canCreate) return { status: 'denied' };
      await createTerminalSelection();
    } else if (action === 'select') {
      if (!state.canSelect) return { status: 'denied' };
      await reviewTerminalSelection();
    } else if (action === 'resumeReview') {
      if (!state.canSelect || !createdTerminalFiles) return { status: 'denied' };
      await reviewTerminalSelection(createdTerminalFiles);
    } else if (action === 'open') {
      if (!state.count || (!state.opened && !state.canSelect)) return { status: 'denied' };
      await openTerminalSelection(0);
    }
    return { status: 'ok', snapshot: studioSnapshot() };
  });
  ipcMain.handle('orqst:managed-agents-open', (event) => {
    if (
      quitting ||
      !window ||
      !authorizedArtifactSender(event, window.webContents, browserSession, origin)
    )
      return { status: 'denied' };
    if (!window.isFocused() || !window.webContents.isFocused()) return { status: 'focus_required' };
    openManagedAgents();
    return { status: 'ok' };
  });
  ipcMain.handle('orqst:save-markdown', async (event, input: unknown) => {
    const current = window;
    const generation = documentGeneration;
    const authorized = () =>
      !quitting &&
      !!current &&
      window === current &&
      !current.isDestroyed() &&
      documentGeneration === generation &&
      authorizedArtifactSender(event, current.webContents, browserSession, origin);
    if (nativeFileBusy || !authorized()) return { status: 'failed' };
    nativeFileBusy = true;
    try {
      return await saver.save(input, {
        authorized,
        original: (selection) =>
          readSaveOriginal(
            (url, init) => browserSession.fetch(url instanceof URL ? url.href : url, init),
            origin,
            selection,
            authorized,
          ),
        choose: async () => {
          const result = await dialog.showSaveDialog(current!, {
            title: i18n.t('artifacts.nativeSave'),
            defaultPath: 'artifact.md',
            filters: [{ name: i18n.t('artifacts.markdownFile'), extensions: ['md'] }],
            properties: ['showOverwriteConfirmation', 'dontAddToRecent'],
          });
          return result.canceled ? undefined : result.filePath;
        },
        confirm: async (path) => {
          const result = await dialog.showMessageBox(current!, {
            type: 'warning',
            title: i18n.t('artifacts.nativeOverwrite'),
            message: i18n.t('artifacts.overwriteMessage'),
            detail: path,
            buttons: [i18n.t('artifacts.cancel'), i18n.t('artifacts.replace')],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          return result.response === 1;
        },
        open: (path) => shell.openPath(path),
      });
    } finally {
      nativeFileBusy = false;
    }
  });

  ipcMain.handle('orqst:analytics-export', async (event, input: unknown) => {
    const current = window;
    const generation = documentGeneration;
    const authorized = () =>
      !quitting &&
      !!current &&
      window === current &&
      !current.isDestroyed() &&
      documentGeneration === generation &&
      authorizedArtifactSender(event, current.webContents, browserSession, origin);
    if (!authorized()) return { status: 'failed' };
    const parsed = analyticsNativeRequestSchema.safeParse(input);
    if (!parsed.success) return { status: 'failed' };
    // Invalidation must remain available while either file operation is busy.
    if (parsed.data.action === 'context') return analyticsSaver.context(parsed.data, generation);
    return analyticsSaver.save(parsed.data, {
      document: generation,
      authorized,
      claim: () => {
        if (nativeFileBusy) return undefined;
        nativeFileBusy = true;
        return () => {
          nativeFileBusy = false;
        };
      },
      read: (reading, active) =>
        readNativeAnalytics(
          (url, init) => browserSession.fetch(url instanceof URL ? url.href : url, init),
          origin,
          reading,
          active,
        ),
      choose: async (request, report) => {
        const csv = request.format === 'csv';
        const result = await dialog.showSaveDialog(current!, {
          title: i18n.t('analytics.export.nativeTitle'),
          message: i18n.t('analytics.export.nativeReading', {
            format: csv ? 'CSV' : 'Markdown',
            ranking: i18n.t(
              request.reading.ranking === 'tokens' ? 'analytics.byTokens' : 'analytics.bySessions',
            ),
            at: request.reading.obtainedAt,
            from: report.query.from ?? i18n.t('analytics.export.unbounded'),
            to: report.query.to ?? i18n.t('analytics.export.unbounded'),
            filters: (['workspaceId', 'agentId', 'adapter', 'model'] as const)
              .map(
                (key) =>
                  `${i18n.t(key === 'workspaceId' ? 'workspaces' : `analytics.${key === 'agentId' ? 'agent' : key}`)}: ${i18n.t(report.query[key] === undefined ? 'analytics.export.filterAll' : 'analytics.export.filterApplied')}`,
              )
              .join('; '),
            sessions: report.sessions,
            tokens: report.usage?.total ?? i18n.t('unknown'),
          }),
          defaultPath: `orqst-model-usage.${csv ? 'csv' : 'md'}`,
          filters: [{ name: csv ? 'CSV' : 'Markdown', extensions: [csv ? 'csv' : 'md'] }],
          properties: ['showOverwriteConfirmation', 'dontAddToRecent'],
        });
        return result.canceled ? undefined : result.filePath;
      },
      confirm: async (path) => {
        const result = await dialog.showMessageBox(current!, {
          type: 'warning',
          title: i18n.t('analytics.export.nativeOverwrite'),
          message: i18n.t('artifacts.overwriteMessage'),
          detail: path,
          buttons: [i18n.t('artifacts.cancel'), i18n.t('artifacts.replace')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return result.response === 1;
      },
    });
  });

  let targetSession: string | undefined;
  function openWindow(): void {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      if (targetSession)
        void window
          .loadURL(`${origin}/#session=${encodeURIComponent(targetSession)}`)
          .catch(() => {});
      window.show();
      window.focus();
      return;
    }
    const current = new BrowserWindow({
      title: 'ORQST',
      icon: applicationIcon,
      width: 1280,
      height: 860,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
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
    window = current;
    current.on('close', (event) => {
      if (!quitting && (terminals || terminalOpening)) {
        event.preventDefault();
        current.hide();
      }
    });
    current.webContents.on('did-start-navigation', () => {
      documentGeneration++;
    });
    current.webContents.on('destroyed', () => {
      documentGeneration++;
    });
    let retry: ReturnType<typeof setTimeout> | undefined;
    let showingOffline = false;
    const clearRetry = () => {
      clearTimeout(retry);
      retry = undefined;
    };
    const showOffline = async () => {
      if (current.isDestroyed() || showingOffline) return;
      showingOffline = true;
      clearRetry();
      try {
        await current.loadURL(offlineURL);
      } catch {
        // Closing a window during navigation cancels it; never restart observation.
      }
      if (!current.isDestroyed()) retry = setTimeout(() => void connect(), 5000);
    };
    const connect = async () => {
      if (current.isDestroyed()) return;
      clearRetry();
      showingOffline = false;
      try {
        await current.loadURL(
          targetSession ? `${origin}/#session=${encodeURIComponent(targetSession)}` : `${origin}/`,
        );
      } catch {
        await showOffline();
      }
    };
    current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    current.webContents.on('will-navigate', (event, url) => {
      if (!allowedNavigation(url, origin)) event.preventDefault();
    });
    current.webContents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame || !allowedNavigation(event.url, origin)) event.preventDefault();
    });
    current.webContents.on('will-redirect', (event, url) => {
      if (!allowedNavigation(url, origin)) event.preventDefault();
    });
    current.webContents.on('will-attach-webview', (event) => event.preventDefault());
    current.webContents.on('did-navigate', (_event, url, status) => {
      if (url.startsWith(origin) && status >= 400) void showOffline();
    });
    current.webContents.on('render-process-gone', () => {
      documentGeneration++;
      showingOffline = false;
      void showOffline();
    });
    current.on('closed', () => {
      documentGeneration++;
      clearRetry();
      if (window === current) window = undefined;
    });
    void connect();
  }
  const monitor = new DesktopMonitor();
  let connected = false;
  let pending = 0;
  let enabled = false;
  let nativeFailed = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const activeNotifications = new Set<Notification>();
  const traySource = nativeImage.createFromPath(
    join(
      iconsDirectory,
      process.platform === 'darwin'
        ? 'orqst-menubar-128.png'
        : process.platform === 'win32'
          ? 'orqst.ico'
          : 'orqst-16.png',
    ),
  );
  if (traySource.isEmpty()) throw new Error('Missing ORQST tray icon');
  // Trim only transparent padding; keep the complete colored artwork and its aspect ratio.
  const macTraySource =
    process.platform === 'darwin'
      ? traySource.crop({ x: 2, y: 12, width: 126, height: 105 })
      : undefined;
  const trayIcon = macTraySource?.resize({ width: 24, height: 20, quality: 'best' }) ?? traySource;
  if (process.platform !== 'win32') {
    trayIcon.addRepresentation({
      scaleFactor: 2,
      buffer: macTraySource
        ? macTraySource.resize({ width: 48, height: 40, quality: 'best' }).toPNG()
        : nativeImage.createFromPath(join(iconsDirectory, 'orqst-32.png')).toPNG(),
    });
  }
  // Preserve the owner-supplied colors instead of applying macOS template tinting.
  if (process.platform === 'darwin') trayIcon.setTemplateImage(false);
  const tray = new Tray(trayIcon);
  const updateTray = () => {
    if (stopped || tray.isDestroyed()) return;
    const state = i18n.t(`desktopShell.${connected ? 'connected' : 'offline'}`);
    tray.setToolTip(
      `ORQST — ${state}${managedLifetime === 'idle' ? '' : ` — ${i18n.t(`managedAgents.lifetime_${managedLifetime}`)}`}`,
    );
    tray.setTitle(connected && pending ? String(pending) : '');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          id: 'desktop-open',
          label: i18n.t('desktopShell.open'),
          click: () => {
            targetSession = undefined;
            openWindow();
          },
        },
        { id: 'desktop-state', label: state, enabled: false },
        {
          id: 'desktop-pending',
          label: i18n.t(connected ? 'desktopShell.pending' : 'desktopShell.pendingUnknown', {
            count: pending,
          }),
          enabled: false,
        },
        { type: 'separator' },
        {
          id: 'desktop-native',
          label: i18n.t('desktopShell.nativeToggle'),
          type: 'checkbox',
          checked: enabled,
          enabled: Notification.isSupported(),
          click: (item) => {
            enabled = item.checked;
            nativeFailed = false;
            updateTray();
          },
        },
        {
          id: 'desktop-native-status',
          label: i18n.t(
            `desktopShell.${nativeFailed ? 'nativeFailed' : !Notification.isSupported() ? 'nativeUnsupported' : enabled ? 'nativeEnabled' : 'nativeDisabled'}`,
          ),
          enabled: false,
        },
        { label: i18n.t('desktopShell.nativeLimit'), enabled: false },
        { type: 'separator' },
        {
          id: 'managed-agents-lifetime',
          label: i18n.t(`managedAgents.lifetime_${managedLifetime}`),
          enabled: false,
        },
        {
          id: 'desktop-managed-agents-open',
          label: i18n.t('managedAgents.title'),
          click: openManagedAgents,
        },
        { id: 'desktop-quit', label: i18n.t('desktopShell.quit'), click: () => app.quit() },
      ]),
    );
  };
  refreshManagedTray = updateTray;
  const fetcher: typeof fetch = (input, init) =>
    browserSession.fetch(input instanceof URL ? input.href : input, init);
  const notify = (alert: NativeAlert) => {
    if (!enabled || !Notification.isSupported()) return;
    let notification: Notification;
    try {
      notification = new Notification({
        title: 'ORQST',
        body: i18n.t(`desktopShell.alert.${alert.category}`),
        silent: alert.silent,
      });
    } catch {
      nativeFailed = true;
      updateTray();
      return;
    }
    if (activeNotifications.size >= 20) {
      const oldest = activeNotifications.values().next().value;
      oldest?.close();
      if (oldest) activeNotifications.delete(oldest);
    }
    activeNotifications.add(notification);
    notification.on('close', () => activeNotifications.delete(notification));
    notification.on('failed', () => {
      activeNotifications.delete(notification);
      nativeFailed = true;
      updateTray();
    });
    notification.on('click', () => {
      // Validate against a fresh authenticated snapshot, never use notification text as identity.
      void readMonitorSnapshot(fetcher, origin)
        .then((snapshot) => {
          if (
            stopped ||
            !snapshot.sessions.some(
              (value) => value.id === alert.sessionId && value.adapter === 'codex',
            )
          )
            return;
          targetSession = alert.sessionId;
          openWindow();
        })
        .catch(() => {});
    });
    try {
      notification.show();
    } catch {
      activeNotifications.delete(notification);
      nativeFailed = true;
      updateTray();
    }
  };
  let lastSnapshotAt = 0;
  const poll = async () => {
    try {
      if (!connected) {
        const response = await fetcher(`${origin}/api/bootstrap`, {
          credentials: 'include',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('Bootstrap unavailable');
        await response.body?.cancel();
      }
      const snapshot = await readMonitorSnapshot(fetcher, origin);
      if (stopped) return;
      if (Date.now() - lastSnapshotAt > 10000) monitor.disconnect();
      lastSnapshotAt = Date.now();
      const result = monitor.accept(snapshot);
      connected = true;
      pending = result.pending;
      for (const alert of result.alerts) notify(alert);
    } catch {
      monitor.disconnect();
      connected = false;
    }
    if (!stopped) {
      updateTray();
      timer = setTimeout(() => void poll(), 2000);
    }
  };
  updateTray();
  void poll();
  app.prependListener('before-quit', (event) => {
    if (terminalOpening) {
      event.preventDefault();
      return;
    }
    if (!openManagedAgents.confirmQuit() || (terminals && !terminals.confirmQuit())) {
      event.preventDefault();
      return;
    }
    quitting = true;
    documentGeneration++;
    ipcMain.removeHandler('orqst:save-markdown');
    ipcMain.removeHandler('orqst:analytics-export');
    ipcMain.removeHandler('orqst:managed-agents-open');
    ipcMain.removeHandler('orqst:studio');
    stopped = true;
    clearTimeout(timer);
    for (const notification of activeNotifications) notification.close();
    activeNotifications.clear();
    tray.destroy();
  });
  app.on('second-instance', () => {
    targetSession = undefined;
    openWindow();
  });
  app.on('activate', () => {
    targetSession = undefined;
    openWindow();
  });
  openWindow();
  if (terminalConfigs.length) {
    terminalOpening = true;
    try {
      terminals = await createManagedTerminals(
        terminalConfigs,
        (key) => i18n.t(key),
        window!,
        terminalLimit,
      );
    } finally {
      terminalOpening = false;
      updateTerminalMenu();
    }
  }
}

// Closing the macOS window detaches only this client; the Bridge owns its lifetime.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
if (!ownsInstance) app.quit();
else
  void start().catch(() => {
    console.error('ORQST Desktop startup failed');
    app.exit(1);
  });
