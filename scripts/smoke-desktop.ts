// Explicit real Electron smoke. Uses only a disposable synthetic Bridge and profile.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  mkdir,
  writeFile,
  appendFile,
  rm,
  realpath,
  readFile,
  stat,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, type ElectronApplication } from '@playwright/test';
import { createBridge } from '../apps/bridge/src/app.js';

const root = await mkdtemp(join(tmpdir(), 'orqst-electron-'));
const sessionsDir = join(root, 'synthetic-sessions');
await mkdir(sessionsDir);
const record = (type: string, payload: unknown) =>
  JSON.stringify({ type, timestamp: new Date().toISOString(), payload }) + '\n';
await writeFile(
  join(sessionsDir, 'synthetic.jsonl'),
  record('session_meta', {
    id: 'synthetic-desktop-smoke',
    cwd: '/synthetic/desktop-smoke',
    agent_nickname: 'Synthetic Desktop Smoke',
  }) +
    record('response_item', {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Disposable synthetic desktop fixture' }],
    }) +
    record('response_item', {
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: '# Synthetic Desktop Artifact\n\n<script>window.orqstInjected=true</script>\n![remote](https://example.invalid/artifact.png)',
        },
      ],
    }),
);
const config = {
  port: 0,
  dataDir: join(root, 'data'),
  sessionsDir,
  dashboardDir: resolve('apps/dashboard/dist'),
  retentionDays: 30,
  pollMs: 500,
  dev: false,
};
let bridge = createBridge(config);
let desktop: ElectronApplication | undefined;
let electronDiagnostics = '';
const evidenceDir = process.env.ORQST_DESKTOP_SMOKE_OUTPUT ?? join(root, 'evidence');
await mkdir(evidenceDir, { recursive: true });
try {
  const port = await bridge.start();
  const origin = `http://127.0.0.1:${port}`;
  const desktopRequire = createRequire(resolve('apps/desktop/package.json'));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
  env.ORQST_DESKTOP_PORT = String(port);
  delete env.ELECTRON_RUN_AS_NODE;
  // Intercept only the bundle's import, retaining the image passed to the real Tray.
  const bootstrap = join(root, 'desktop-bootstrap.cjs');
  await writeFile(
    bootstrap,
    `const Module = require('node:module');
const load = Module._load;
Module._load = function (id, parent, ...args) {
  const exported = load.call(this, id, parent, ...args);
  if (id !== 'electron' || parent?.filename !== ${JSON.stringify(resolve('apps/desktop/dist/main.cjs'))}) return exported;
  return { ...exported, Tray: new Proxy(exported.Tray, {
    construct(target, args) {
      globalThis.syntheticDesktopTrayImage = args[0];
      return Reflect.construct(target, args);
    }
  }) };
};
require(${JSON.stringify(resolve('apps/desktop'))});
Module._load = load;
`,
  );
  desktop = await _electron.launch({
    executablePath: desktopRequire('electron') as string,
    args: [bootstrap, `--user-data-dir=${join(root, 'profile')}`],
    env,
    timeout: 30000,
  });
  desktop.process().stderr?.on('data', (chunk: Buffer) => {
    electronDiagnostics = (electronDiagnostics + chunk.toString()).slice(-16000);
  });
  assert.equal(
    await desktop.evaluate(({ app }) => app.getPath('userData')),
    await realpath(join(root, 'profile')),
  );
  let page = await desktop.firstWindow();
  if (process.platform === 'darwin') {
    const icon = await desktop.evaluate(({ nativeImage }) => {
      const image = Reflect.get(globalThis, 'syntheticDesktopTrayImage') as Electron.NativeImage;
      return {
        size: image.getSize(),
        scales: image.getScaleFactors(),
        template: image.isTemplateImage(),
        representations: [1, 2].map((scaleFactor) => {
          const decoded = nativeImage.createFromBuffer(image.toPNG({ scaleFactor }));
          const { width, height } = decoded.getSize();
          const bitmap = decoded.toBitmap();
          let left = width;
          let top = height;
          let right = -1;
          let bottom = -1;
          let colored = false;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const offset = (y * width + x) * 4;
              if (bitmap[offset + 3]! <= 8) continue;
              left = Math.min(left, x);
              top = Math.min(top, y);
              right = Math.max(right, x);
              bottom = Math.max(bottom, y);
              colored ||=
                bitmap[offset] !== bitmap[offset + 1] || bitmap[offset + 1] !== bitmap[offset + 2];
            }
          }
          return {
            width,
            height,
            visibleWidth: right - left + 1,
            visibleHeight: bottom - top + 1,
            colored,
          };
        }),
      };
    });
    assert.deepEqual(icon.size, { width: 24, height: 20 });
    assert.deepEqual(icon.scales, [1, 2]);
    assert.equal(icon.template, false);
    for (const [index, representation] of icon.representations.entries()) {
      const scale = index + 1;
      assert.equal(representation.width, 24 * scale);
      assert.equal(representation.height, 20 * scale);
      assert.ok(representation.visibleWidth >= 22 * scale);
      assert.ok(representation.visibleHeight >= 18 * scale);
      assert.equal(representation.colored, true);
    }
    console.log('Menu-bar icon:', JSON.stringify(icon));
  }
  // Test-only instrumentation in the main process; no shipped IPC/test endpoint.
  // Capture the real Tray menu and Notification objects, suppress actual OS delivery.
  await desktop.evaluate(({ Tray, Notification }) => {
    const original = Tray.prototype.setContextMenu;
    Tray.prototype.setContextMenu = function (menu) {
      Reflect.set(globalThis, 'syntheticDesktopMenu', menu);
      Reflect.set(globalThis, 'syntheticDesktopTray', this);
      return original.call(this, menu);
    };
    Reflect.set(globalThis, 'syntheticDesktopAlerts', []);
    Notification.prototype.show = function () {
      const alerts = Reflect.get(globalThis, 'syntheticDesktopAlerts') as Electron.Notification[];
      alerts.push(this);
    };
  });
  await expect
    .poll(() => desktop!.evaluate(() => Boolean(Reflect.get(globalThis, 'syntheticDesktopMenu'))))
    .toBe(true);
  await desktop.evaluate(() => {
    const menu = Reflect.get(globalThis, 'syntheticDesktopMenu') as Electron.Menu;
    const item = menu.getMenuItemById('desktop-native')!;
    item.checked = false;
    item.click();
  });
  assert.equal(
    await desktop.evaluate(
      () =>
        (Reflect.get(globalThis, 'syntheticDesktopMenu') as Electron.Menu).getMenuItemById(
          'desktop-native',
        )!.checked,
    ),
    true,
  );
  await expect(page.locator('.connection-connected')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Synthetic Desktop Smoke Disposable/ }),
  ).toBeVisible();
  assert.deepEqual(
    await page.evaluate(() => ({
      require: typeof Reflect.get(window, 'require'),
      process: typeof Reflect.get(window, 'process'),
    })),
    { require: 'undefined', process: 'undefined' },
  );
  // Exercise the real shared Artifacts UI; clipboard permission remains denied.
  await page.getByRole('button', { name: /Synthetic Desktop Smoke Disposable/ }).click();
  const metrics = page.locator('.session-detail > .live-metrics');
  await expect(metrics).toContainText(/No cumulative token snapshot|Nenhum snapshot cumulativo/);
  await appendFile(
    join(sessionsDir, 'synthetic.jsonl'),
    record('token_usage_record', {
      thread_id: 'synthetic-desktop-smoke',
      thread_token_usage: {
        input_tokens: 100,
        output_tokens: 20,
        cached_input_tokens: 40,
        total_tokens: 120,
      },
    }),
  );
  await expect(metrics.locator('.live-metric-values strong')).toHaveText([
    '100',
    '20',
    '40',
    '120',
  ]);
  await page
    .getByRole('button', { name: /Extract artifact manually|Extrair artefato manualmente/ })
    .click();
  const artifact = page.locator('.artifact-panel');
  await expect(artifact.locator('.live-metric-values strong')).toHaveText([
    '100',
    '20',
    '40',
    '120',
  ]);
  await expect(artifact.locator('pre.artifact-content')).toContainText(
    'Synthetic Desktop Artifact',
  );
  await artifact
    .getByRole('button', { name: /Copy original Markdown|Copiar Markdown original/ })
    .click();
  await expect(artifact.locator('[role="alert"], [role="status"]')).toContainText(
    /Copied to clipboard|Clipboard copy failed|Copiado para|A cópia falhou/,
  );
  const artifactClipboard = await artifact.locator('[role="alert"], [role="status"]').innerText();
  await artifact.getByRole('button', { name: /Edit draft|Editar rascunho/, exact: true }).click();
  await artifact
    .getByRole('textbox')
    .fill(
      '# Synthetic edited Desktop draft\n- safe text\n<img src="https://example.invalid/x" onerror="window.orqstInjected=true">',
    );
  await artifact
    .getByRole('button', { name: /Draft preview|Prévia do rascunho/, exact: true })
    .click();
  await expect(
    artifact.getByRole('heading', { name: 'Synthetic edited Desktop draft' }),
  ).toBeVisible();
  assert.equal(await artifact.locator('a,img,iframe,script,object,embed').count(), 0);
  assert.equal(await page.evaluate(() => Reflect.get(window, 'orqstInjected')), undefined);
  await artifact
    .getByRole('button', { name: /Original source|Fonte original/, exact: true })
    .click();
  await expect(artifact.locator('pre.artifact-content')).toContainText(
    'Synthetic Desktop Artifact',
  );
  await expect(artifact.locator('pre.artifact-content')).not.toContainText('edited Desktop draft');
  // Only this disposable main process is instrumented. Real IPC/preload, sender checks,
  // authenticated reextraction and filesystem writes run; native UI/editor dispatch is intercepted.
  const savedArtifact = join(await realpath(root), 'synthetic-artifact.md');
  await desktop.evaluate(({ dialog, shell }, path) => {
    Reflect.set(globalThis, 'syntheticSavePath', path);
    Reflect.set(globalThis, 'syntheticSaveCancel', true);
    Reflect.set(globalThis, 'syntheticOverwrite', false);
    Reflect.set(globalThis, 'syntheticOpened', []);
    Reflect.set(globalThis, 'syntheticSaveOptions', []);
    dialog.showSaveDialog = async (
      _window: Electron.BaseWindow | Electron.SaveDialogOptions,
      options?: Electron.SaveDialogOptions,
    ) => {
      (Reflect.get(globalThis, 'syntheticSaveOptions') as unknown[]).push(options);
      return {
        canceled: Boolean(Reflect.get(globalThis, 'syntheticSaveCancel')),
        filePath: Reflect.get(globalThis, 'syntheticSavePath') as string,
      };
    };
    dialog.showMessageBox = async (
      _window: Electron.BaseWindow | Electron.MessageBoxOptions,
      options?: Electron.MessageBoxOptions,
    ) => {
      Reflect.set(globalThis, 'syntheticOverwriteDetail', options?.detail);
      return {
        response: Reflect.get(globalThis, 'syntheticOverwrite') ? 1 : 0,
        checkboxChecked: false,
      };
    };
    shell.openPath = async (value) => {
      (Reflect.get(globalThis, 'syntheticOpened') as string[]).push(value);
      return '';
    };
  }, savedArtifact);
  const saveOriginal = artifact.getByRole('button', {
    name: /Save original Markdown|Salvar Markdown original/,
  });
  await saveOriginal.click();
  await expect(artifact.getByRole('status')).toContainText(/Save cancelled|Salvamento cancelado/);
  assert.equal(
    await stat(savedArtifact).then(
      () => true,
      () => false,
    ),
    false,
  );
  await desktop.evaluate(() => Reflect.set(globalThis, 'syntheticSaveCancel', false));
  await saveOriginal.click();
  await expect(artifact.getByRole('status')).toContainText(
    /Markdown file saved|Arquivo Markdown salvo/,
  );
  assert.equal(
    await readFile(savedArtifact, 'utf8'),
    await artifact.locator('pre.artifact-content').innerText(),
  );
  await writeFile(savedArtifact, 'Synthetic existing file');
  await saveOriginal.click();
  await expect(artifact.getByRole('status')).toContainText(/Save cancelled|Salvamento cancelado/);
  assert.equal(await readFile(savedArtifact, 'utf8'), 'Synthetic existing file');
  assert.equal(
    await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticOverwriteDetail')),
    savedArtifact,
  );
  await desktop.evaluate(() => Reflect.set(globalThis, 'syntheticOverwrite', true));
  await saveOriginal.click();
  await expect(artifact.getByRole('status')).toContainText(
    /Markdown file saved|Arquivo Markdown salvo/,
  );
  await artifact.getByRole('button', { name: /Edit draft|Editar rascunho/, exact: true }).click();
  const savedDraft = '# Synthetic saved draft 😀\n<script>bad()</script>\n$(bad)';
  await artifact.getByRole('textbox').fill(savedDraft);
  await artifact
    .getByRole('button', { name: /Save draft and open|Salvar rascunho e abrir/ })
    .click();
  await expect(artifact.getByRole('status')).toContainText(/handed to|encaminhado/);
  assert.equal(await readFile(savedArtifact, 'utf8'), savedDraft);
  assert.deepEqual(await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticOpened')), [
    savedArtifact,
  ]);
  assert.equal(await page.evaluate(() => Reflect.get(window, 'orqstInjected')), undefined);
  const nativeSaveOptions = await desktop.evaluate(() =>
    Reflect.get(globalThis, 'syntheticSaveOptions'),
  );
  assert.match(JSON.stringify(nativeSaveOptions), /showOverwriteConfirmation/);
  const beforeRevocationURL = page.url();
  await artifact.getByRole('textbox').fill('Synthetic revoked overwrite must never be saved');
  await desktop.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () =>
      new Promise<Electron.MessageBoxReturnValue>((resolve) => {
        Reflect.set(globalThis, 'syntheticPendingOverwrite', resolve);
      });
  });
  await artifact
    .getByRole('button', { name: /Save draft and open|Salvar rascunho e abrir/ })
    .click();
  await expect
    .poll(() =>
      desktop!.evaluate(() => typeof Reflect.get(globalThis, 'syntheticPendingOverwrite')),
    )
    .toBe('function');
  await page.goto(origin + '/#models');
  await expect(page.locator('.analytics-export')).toContainText(
    /Choose a native destination|Escolha um destino nativo/,
  );
  await expect(page.locator('.analytics-export button')).toHaveCount(2);
  await expect(page.locator('.analytics-export a[download]')).toHaveCount(0);
  await page.goto(beforeRevocationURL);
  await expect(page.locator('.connection-connected')).toBeVisible();
  await desktop.evaluate(() => {
    (
      Reflect.get(globalThis, 'syntheticPendingOverwrite') as (
        value: Electron.MessageBoxReturnValue,
      ) => void
    )({ response: 1, checkboxChecked: false });
  });
  // Later admission proves the revoked operation drained, rather than merely delaying effects.
  await page.getByRole('button', { name: /Synthetic Desktop Smoke Disposable/ }).click();
  await page
    .getByRole('button', { name: /Extract artifact manually|Extrair artefato manualmente/ })
    .click();
  const revokedDestination = join(await realpath(root), 'revoked-destination.md');
  await desktop.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () =>
      new Promise<Electron.SaveDialogReturnValue>((resolve) => {
        Reflect.set(globalThis, 'syntheticPendingChoose', resolve);
      });
  });
  await artifact
    .getByRole('button', { name: /Save original Markdown|Salvar Markdown original/ })
    .click();
  await expect
    .poll(() => desktop!.evaluate(() => typeof Reflect.get(globalThis, 'syntheticPendingChoose')))
    .toBe('function');
  assert.equal(await readFile(savedArtifact, 'utf8'), savedDraft);
  assert.deepEqual(await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticOpened')), [
    savedArtifact,
  ]);
  await page.goto(origin + '/#models');
  await page.goto(beforeRevocationURL);
  await expect(page.locator('.connection-connected')).toBeVisible();
  await desktop.evaluate((_, path) => {
    (
      Reflect.get(globalThis, 'syntheticPendingChoose') as (
        value: Electron.SaveDialogReturnValue,
      ) => void
    )({ canceled: false, filePath: path });
  }, revokedDestination);
  await page.getByRole('button', { name: /Synthetic Desktop Smoke Disposable/ }).click();
  await page
    .getByRole('button', { name: /Extract artifact manually|Extrair artefato manualmente/ })
    .click();
  await desktop.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' });
  });
  await artifact
    .getByRole('button', { name: /Save original Markdown|Salvar Markdown original/ })
    .click();
  await expect(artifact.getByRole('status')).toContainText(/Save cancelled|Salvamento cancelado/);
  assert.equal(
    await stat(revokedDestination).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.deepEqual(await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticOpened')), [
    savedArtifact,
  ]);
  await artifact
    .getByRole('button', {
      name: /Close artifact and discard draft|Fechar artefato e descartar rascunho/,
    })
    .click();
  // Native Analytics uses its own capability and the same real session/IPC path.
  await page.goto(origin + '/#models');
  const exports = page.locator('.analytics-export');
  const csvButton = exports.getByRole('button', { name: /Export CSV|Exportar CSV/ });
  const mdButton = exports.getByRole('button', { name: /Export Markdown|Exportar Markdown/ });
  const refreshReport = async () => {
    await page.getByRole('button', { name: /Refresh|Atualizar/, exact: true }).click();
    await expect(csvButton).toBeEnabled();
  };
  const csvPath = join(await realpath(root), 'synthetic-analytics.csv');
  const mdPath = join(await realpath(root), 'synthetic-analytics.md');
  await desktop.evaluate(({ dialog }, path) => {
    Reflect.set(globalThis, 'syntheticAnalyticsPath', path);
    Reflect.set(globalThis, 'syntheticAnalyticsCancel', true);
    Reflect.set(globalThis, 'syntheticAnalyticsOverwrite', false);
    dialog.showSaveDialog = async (
      _window: Electron.BaseWindow | Electron.SaveDialogOptions,
      options?: Electron.SaveDialogOptions,
    ) => {
      Reflect.set(globalThis, 'syntheticAnalyticsOptions', options);
      return {
        canceled: Boolean(Reflect.get(globalThis, 'syntheticAnalyticsCancel')),
        filePath: Reflect.get(globalThis, 'syntheticAnalyticsPath') as string,
      };
    };
    dialog.showMessageBox = async (
      _window: Electron.BaseWindow | Electron.MessageBoxOptions,
      options?: Electron.MessageBoxOptions,
    ) => {
      Reflect.set(globalThis, 'syntheticAnalyticsDetail', options?.detail);
      return {
        response: Reflect.get(globalThis, 'syntheticAnalyticsOverwrite') ? 1 : 0,
        checkboxChecked: false,
      };
    };
  }, csvPath);
  await expect(csvButton).toBeEnabled();
  await csvButton.click();
  await expect(exports.getByRole('status')).toContainText(/Save cancelled|Salvamento cancelado/);
  await expect(csvButton).toBeDisabled();
  assert.equal(
    await stat(csvPath).then(
      () => true,
      () => false,
    ),
    false,
  );
  await desktop.evaluate(() => Reflect.set(globalThis, 'syntheticAnalyticsCancel', false));
  await refreshReport();
  await csvButton.click();
  await expect(exports.getByRole('status')).toContainText(/Report saved|Relatório salvo/);
  const savedCSV = await readFile(csvPath, 'utf8');
  assert.ok(savedCSV.startsWith(`"'section"`));
  assert.ok(savedCSV.includes('orqst.model-usage-export.v1'));
  assert.ok(!savedCSV.includes('synthetic-desktop-smoke'));
  assert.ok(!savedCSV.includes('/synthetic/desktop-smoke'));
  assert.ok(!savedCSV.includes('Synthetic Desktop Artifact'));
  assert.deepEqual(
    await desktop.evaluate(
      () =>
        (Reflect.get(globalThis, 'syntheticAnalyticsOptions') as Electron.SaveDialogOptions)
          .filters,
    ),
    [{ name: 'CSV', extensions: ['csv'] }],
  );
  await writeFile(csvPath, 'Synthetic overwrite retained');
  await refreshReport();
  await csvButton.click();
  await expect(exports.getByRole('status')).toContainText(/Save cancelled|Salvamento cancelado/);
  assert.equal(await readFile(csvPath, 'utf8'), 'Synthetic overwrite retained');
  assert.equal(
    await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticAnalyticsDetail')),
    csvPath,
  );
  await desktop.evaluate(() => Reflect.set(globalThis, 'syntheticAnalyticsOverwrite', true));
  await refreshReport();
  await csvButton.click();
  await expect(exports.getByRole('status')).toContainText(/Report saved|Relatório salvo/);
  assert.ok((await readFile(csvPath, 'utf8')).startsWith(`"'section"`));
  await desktop.evaluate(
    (_, path) => Reflect.set(globalThis, 'syntheticAnalyticsPath', path),
    mdPath,
  );
  await refreshReport();
  await mdButton.click();
  await expect(exports.getByRole('status')).toContainText(/Report saved|Relatório salvo/);
  assert.ok((await readFile(mdPath, 'utf8')).startsWith('| `section`'));
  // A wrong extension is never silently changed or written.
  const wrongPath = join(await realpath(root), 'synthetic-analytics.txt');
  await desktop.evaluate(
    (_, path) => Reflect.set(globalThis, 'syntheticAnalyticsPath', path),
    wrongPath,
  );
  await refreshReport();
  await csvButton.click();
  await expect(exports.getByRole('alert')).toContainText(
    /refused before writing|recusado antes da escrita/,
  );
  assert.equal(
    await stat(wrongPath).then(
      () => true,
      () => false,
    ),
    false,
  );
  // A context update stays live during a pending native dialog.
  await desktop.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () =>
      new Promise<Electron.SaveDialogReturnValue>((resolve) =>
        Reflect.set(globalThis, 'syntheticAnalyticsPending', resolve),
      );
  });
  await refreshReport();
  await csvButton.click();
  await expect
    .poll(() =>
      desktop!.evaluate(() => typeof Reflect.get(globalThis, 'syntheticAnalyticsPending')),
    )
    .toBe('function');
  await page.getByLabel(/Rank by|Ordenar por/).selectOption('sessions');
  const revokedCSV = join(await realpath(root), 'synthetic-analytics-revoked.csv');
  await desktop.evaluate((_, path) => {
    (
      Reflect.get(globalThis, 'syntheticAnalyticsPending') as (
        value: Electron.SaveDialogReturnValue,
      ) => void
    )({ canceled: false, filePath: path });
  }, revokedCSV);
  await expect(exports.getByText(/Checking this reading|Conferindo esta leitura/)).toHaveCount(0);
  assert.equal(
    await stat(revokedCSV).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.deepEqual(await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticOpened')), [
    savedArtifact,
  ]);
  await page.goto(beforeRevocationURL);
  await expect(page.locator('.connection-connected')).toBeVisible();
  const versions = await desktop.evaluate(() => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    modules: process.versions.modules,
    arch: process.arch,
  }));
  await page.evaluate(() => window.open('https://example.com/'));
  assert.equal(desktop.windows().length, 1);
  assert.equal(await page.evaluate(() => Notification.requestPermission()), 'denied');
  const cookies = await desktop.evaluate(
    ({ session }, url) => session.fromPartition('orqst-desktop').cookies.get({ url }),
    origin,
  );
  const cookie = cookies.find((value) => value.name === 'orqst_session');
  assert.equal(cookie?.httpOnly, true);
  assert.equal(cookie.sameSite, 'strict');
  assert.equal(await page.evaluate(() => document.cookie.includes('orqst_session')), false);
  await page.screenshot({ path: join(evidenceDir, 'online.png') });
  const alertCount = () =>
    desktop!.evaluate(
      () => (Reflect.get(globalThis, 'syntheticDesktopAlerts') as Electron.Notification[]).length,
    );
  assert.equal(await alertCount(), 0, 'startup history never alerts');
  await appendFile(
    join(sessionsDir, 'synthetic.jsonl'),
    record('event_msg', {
      type: 'task_complete',
      last_agent_message: 'PRIVATE synthetic content never in native alert',
    }),
  );
  await expect.poll(alertCount).toBe(1);
  const nativeContent = await desktop.evaluate(() => {
    const alert = (
      Reflect.get(globalThis, 'syntheticDesktopAlerts') as Electron.Notification[]
    )[0]!;
    return { title: alert.title, body: alert.body, silent: alert.silent };
  });
  assert.equal(nativeContent.title, 'ORQST');
  assert.match(nativeContent.body, /Observed turn completed|Turno observado concluído/);
  assert.equal(nativeContent.silent, true);
  assert.equal(JSON.stringify(nativeContent).includes('PRIVATE'), false);
  await expect
    .poll(() =>
      desktop!.evaluate(() =>
        (Reflect.get(globalThis, 'syntheticDesktopTray') as Electron.Tray).getTitle(),
      ),
    )
    .toBe('1');
  // Main-process click handler revalidates identity and the renderer selects that session.
  await desktop.evaluate(() => {
    (Reflect.get(globalThis, 'syntheticDesktopAlerts') as Electron.Notification[])[0]!.emit(
      'click',
    );
  });
  await expect(
    page.getByRole('region', { name: /Session details|Detalhes da sessão/ }),
  ).toBeVisible();
  // Exercise native failure reporting without claiming OS visual delivery.
  await desktop.evaluate(() => {
    (Reflect.get(globalThis, 'syntheticDesktopAlerts') as Electron.Notification[])[0]!.emit(
      'failed',
      {},
      'synthetic failure',
    );
  });
  assert.match(
    await desktop.evaluate(
      () =>
        (Reflect.get(globalThis, 'syntheticDesktopMenu') as Electron.Menu).getMenuItemById(
          'desktop-native-status',
        )!.label,
    ),
    /failed|falhou/,
  );
  await page.evaluate(async () => {
    await fetch('/api/notifications/read', { method: 'POST' });
  });
  await expect
    .poll(() =>
      desktop!.evaluate(() =>
        (Reflect.get(globalThis, 'syntheticDesktopTray') as Electron.Tray).getTitle(),
      ),
    )
    .toBe('');
  const secondLaunch = () =>
    promisify(execFile)(
      desktopRequire('electron') as string,
      [resolve('apps/desktop'), `--user-data-dir=${join(root, 'profile')}`],
      { env, timeout: 10000 },
    );
  // A second real process with the same disposable profile restores the first window.
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.minimize());
  await secondLaunch();
  await expect
    .poll(() =>
      desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized()),
    )
    .toBe(false);
  assert.equal(desktop.windows().length, 1);
  // Restore a minimized window through the tray.
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.minimize());
  await desktop.evaluate(() => {
    (Reflect.get(globalThis, 'syntheticDesktopMenu') as Electron.Menu)
      .getMenuItemById('desktop-open')!
      .click();
  });
  await expect
    .poll(() =>
      desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized()),
    )
    .toBe(false);
  // Close/reopen the native window while proving the independently owned Bridge lives.
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect
    .poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(0);
  assert.equal((await fetch(`${origin}/api/bootstrap`)).status, 200);
  // The main-process monitor remains active with no renderer/window.
  await appendFile(
    join(sessionsDir, 'synthetic.jsonl'),
    record('response_item', {
      type: 'function_call',
      name: 'request_user_input',
      call_id: 'synthetic-input',
      arguments: 'PRIVATE synthetic prompt',
    }),
  );
  await expect.poll(alertCount).toBe(2);
  const reopened = desktop.waitForEvent('window');
  await desktop.evaluate(() => {
    (Reflect.get(globalThis, 'syntheticDesktopMenu') as Electron.Menu)
      .getMenuItemById('desktop-open')!
      .click();
  });
  page = await reopened;
  await expect(page.locator('.connection-connected')).toBeVisible();
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect
    .poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(0);
  const singleInstanceReopened = desktop.waitForEvent('window');
  await secondLaunch();
  page = await singleInstanceReopened;
  await expect(page.locator('.connection-connected')).toBeVisible();
  await bridge.stop();
  await expect(page.locator('.connection-offline')).toBeVisible({ timeout: 15000 });
  bridge = createBridge({ ...config, port });
  await bridge.start();
  await expect(page.locator('.connection-connected')).toBeVisible({ timeout: 20000 });
  // Loading/reopening while the Bridge is absent exercises the script-free offline page.
  await bridge.stop();
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect
    .poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(0);
  const offlineWindow = desktop.waitForEvent('window');
  await desktop.evaluate(({ app }) => app.emit('activate'));
  page = await offlineWindow;
  await expect(page).toHaveURL('orqst-desktop://offline/');
  await expect(page.locator('h1')).toContainText(/Bridge/);
  await page.screenshot({ path: join(evidenceDir, 'offline.png') });
  bridge = createBridge({ ...config, port });
  await bridge.start();
  await expect(page.locator('.connection-connected')).toBeVisible({ timeout: 20000 });
  assert.equal(await alertCount(), 2, 'window reopen/reconnect does not repeat alerts');
  const exit = new Promise<void>((resolve) => desktop!.process().once('exit', () => resolve()));
  await desktop
    .evaluate(() => {
      (Reflect.get(globalThis, 'syntheticDesktopMenu') as Electron.Menu)
        .getMenuItemById('desktop-quit')!
        .click();
    })
    .catch(() => {});
  await exit;
  desktop = undefined;
  assert.equal((await fetch(`${origin}/api/bootstrap`)).status, 200);
  console.log(
    JSON.stringify(
      {
        result: 'passed',
        platform: process.platform,
        versions,
        nativeDelivery: 'intercepted: mechanism only, no visual delivery claim',
        artifactClipboard,
        analyticsFiles:
          'real IPC/session/aggregate reobtain and bounded shared serializer; CSV/Markdown new save, cancel, overwrite deny+accept, wrong extension, ranking revocation; dialogs intercepted',
        artifactFiles:
          'cancel/save/overwrite deny+accept/UTF8 hostile draft/current-file-only open/revocation during choose+confirm after navigation-return passed; dialogs/editor intercepted',
      },
      null,
      2,
    ),
  );
  console.log(`Window evidence: ${evidenceDir}`);
} catch (error) {
  console.error(electronDiagnostics);
  throw error;
} finally {
  await desktop?.close();
  await bridge.stop();
  await rm(root, { recursive: true, force: true });
}
