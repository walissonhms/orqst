import { app, BrowserWindow, Menu, protocol, session } from 'electron';
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

  function openWindow(): void {
    if (window && !window.isDestroyed()) {
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
        await current.loadURL(`${origin}/`);
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
      showingOffline = false;
      void showOffline();
    });
    current.on('closed', () => {
      clearRetry();
      if (window === current) window = undefined;
    });
    void connect();
  }
  app.on('activate', openWindow);
  openWindow();
}

// Closing the macOS window detaches only this client; the Bridge owns its lifetime.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
void start().catch(() => {
  console.error('ORQST Desktop startup failed');
  app.exit(1);
});
