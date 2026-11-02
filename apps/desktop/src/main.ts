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
]);
const origin = bridgeOrigin(process.env.ORQST_DESKTOP_PORT);
let window: BrowserWindow | undefined;
const ownsInstance = app.requestSingleInstanceLock();

async function start(): Promise<void> {
  await app.whenReady();
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
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
  );

  const saver = new ArtifactSaver();
  let documentGeneration = 0;
  let quitting = false;
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
    return saver.save(input, {
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
  // Owned monochrome 16x16 template icon, generated from a fixed pixel pattern.
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 2; y < 14; y++)
    for (let x = 2; x < 14; x++) {
      if (x < 5 || x > 10 || y < 5 || y > 10) pixels[(y * 16 + x) * 4 + 3] = 255;
    }
  const icon = nativeImage.createFromBitmap(pixels, { width: 16, height: 16, scaleFactor: 1 });
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  const updateTray = () => {
    if (stopped || tray.isDestroyed()) return;
    const state = i18n.t(`desktopShell.${connected ? 'connected' : 'offline'}`);
    tray.setToolTip(`ORQST — ${state}`);
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
        { id: 'desktop-quit', label: i18n.t('desktopShell.quit'), click: () => app.quit() },
      ]),
    );
  };
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
  app.on('before-quit', () => {
    quitting = true;
    documentGeneration++;
    ipcMain.removeHandler('orqst:save-markdown');
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
