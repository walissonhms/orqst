// Synthetic fixtures only: temporary directories, synthetic Mach-O header and headless Chromium.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import {
  DEFAULT_FEATURE_NAME,
  defaultFeatureId,
  featureDisplayName,
  type StructuredAgentsSnapshot,
} from '../packages/protocol/src/index.js';
import { resolveMentions } from '../apps/dashboard/src/MentionComposer.js';
import { Store } from '../packages/database/src/index.js';
import {
  reviewedCodex169Binary,
  terminalExecutableSha256,
} from '../packages/core/src/terminal/codex-profile.js';
import { reviewedDesktopCodexBinary } from '../apps/desktop/src/terminal-creation.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';
import { reviewedClaudeTuiBinary } from '../packages/core/src/terminal/interactive-profile.js';
import { reviewedAntigravityBinary } from '../packages/core/src/terminal/antigravity-launch-plan.js';
import { featureConfigurationDatabase } from '../packages/core/src/terminal/feature-configuration.js';
import { validateTerminalPreparationBinding } from '../packages/core/src/terminal/preparation-context.js';
import { recordComposerMention } from '../packages/core/src/terminal/composer-mentions.js';
import { HubRefusal, TerminalMessageHub } from '../packages/core/src/terminal/mcp-hub.js';
import { structuredMentionGrant } from '../apps/desktop/src/structured-mention.js';

const bundle = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-always-feature-')));
after(() => rmSync(bundle, { recursive: true, force: true }));
const binary = join(bundle, 'synthetic-binary');
writeFileSync(binary, Buffer.from([0xfe, 0xed, 0xfa, 0xcf, 0, 0, 0, 0]), { mode: 0o700 });
const hash = terminalExecutableSha256(binary);
const newCodexBinary = join(bundle, 'synthetic-codex-169');
writeFileSync(newCodexBinary, Buffer.concat([readFileSync(binary), Buffer.from('synthetic 169')]), {
  mode: 0o700,
});
const newCodexHash = terminalExecutableSha256(newCodexBinary);

await build({
  entryPoints: {
    preparation: 'apps/desktop/src/tauri-terminal-preparation.ts',
    profiles: 'packages/core/src/terminal/interactive-profile.ts',
  },
  outdir: bundle,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  logLevel: 'silent',
  plugins: [
    {
      name: 'synthetic-binary-pins-only',
      setup(builder) {
        builder.onLoad(
          {
            filter:
              /(?:terminal-creation|provider-mcp-config|interactive-profile|codex-profile|antigravity-launch-plan)\.ts$/,
          },
          (args) => ({
            contents: readFileSync(args.path, 'utf8')
              .replaceAll(reviewedDesktopCodexBinary.sha256, hash)
              .replaceAll(reviewedCodex169Binary.sha256, newCodexHash)
              .replaceAll(reviewedProviderMcpBinaries.claude.sha256, hash)
              .replaceAll(reviewedClaudeTuiBinary.sha256, hash)
              .replaceAll(reviewedProviderMcpBinaries.opencode.sha256, hash)
              .replaceAll(reviewedAntigravityBinary.sha256, hash),
            loader: 'ts',
          }),
        );
      },
    },
  ],
});

const { prepareTauriTerminals } = (await import(
  pathToFileURL(join(bundle, 'preparation.cjs')).href
)) as typeof import('../apps/desktop/src/tauri-terminal-preparation.js');
const { readInteractiveTerminalConfig } = (await import(
  pathToFileURL(join(bundle, 'profiles.cjs')).href
)) as typeof import('../packages/core/src/terminal/interactive-profile.js');

function preparationFixture(locale = 'en-US') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-always-in-feature-')));
  chmodSync(root, 0o700);
  const home = join(root, 'native');
  const parent = join(root, 'profiles');
  const project = join(root, 'actual-project');
  const preferencesDirectory = join(root, 'preferences');
  const bin = join(root, 'bin');
  for (const directory of [home, parent, project, preferencesDirectory, bin])
    mkdirSync(directory, { mode: 0o700 });
  mkdirSync(join(home, '.codex'), { mode: 0o700 });
  mkdirSync(join(home, '.claude'), { mode: 0o700 });
  mkdirSync(join(home, '.config/opencode'), { recursive: true, mode: 0o700 });
  mkdirSync(join(home, '.gemini/antigravity-cli'), { recursive: true, mode: 0o700 });
  for (const provider of ['codex', 'claude', 'opencode', 'agy'])
    writeFileSync(join(bin, provider), readFileSync(binary), { mode: 0o700 });
  writeFileSync(join(project, 'SYNTHETIC-EXISTING-SOURCE'), 'Preserve selected project', {
    mode: 0o600,
  });
  writeFileSync(join(home, '.codex/config.toml'), 'model = "synthetic-model"\n', { mode: 0o600 });
  writeFileSync(join(home, '.claude/settings.json'), '{"model":"sonnet"}', {
    mode: 0o600,
  });
  writeFileSync(join(home, '.config/opencode/opencode.json'), '{"model":"synthetic/model"}', {
    mode: 0o600,
  });
  writeFileSync(
    join(home, '.gemini/antigravity-cli/settings.json'),
    '{"model":"gemini-4-carbon-medium"}',
    { mode: 0o600 },
  );
  const observerDatabase = join(root, 'observer.sqlite');
  const store = new Store(observerDatabase);
  const workspaceId = store.workspace(project, 'Synthetic project');
  store.close();
  return {
    root,
    project,
    workspaceId,
    preferencesDirectory,
    trusted: { observerDatabase, preferencesDirectory },
    context: {
      home,
      parent,
      node: realpathSync(process.execPath),
      environment: {
        HOME: home,
        PATH: bin + ':/usr/bin:/bin',
        LANG: locale === 'pt-BR' ? 'pt_BR.UTF-8' : 'en_US.UTF-8',
      },
    },
    ports: {
      current: () => true,
      choose: async () => {
        throw new Error('Finder must never participate');
      },
      confirm: async () => true,
      commit: async () => true,
    },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('defaultFeatureId is stable per workspace and featureDisplayName localizes General/Geral while keeping user renames', () => {
  const idA = defaultFeatureId('synthetic-workspace-a');
  const idA2 = defaultFeatureId('synthetic-workspace-a');
  const idB = defaultFeatureId('synthetic-workspace-b');
  assert.equal(idA, idA2);
  assert.notEqual(idA, idB);
  assert.match(idA, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const base = { workspaceId: 'synthetic-workspace-a', featureId: idA };
  assert.equal(
    featureDisplayName({ ...base, name: DEFAULT_FEATURE_NAME }, 'Geral'),
    'Geral',
    'English stored default localizes to pt-BR',
  );
  assert.equal(
    featureDisplayName({ ...base, name: 'Geral' }, 'General'),
    'General',
    'Portuguese stored default localizes to en-US',
  );
  assert.equal(
    featureDisplayName({ ...base, name: 'Custom Team' }, 'Geral'),
    'Custom Team',
    'User renames are preserved across locales',
  );
  assert.equal(
    featureDisplayName(
      { workspaceId: 'synthetic-workspace-a', featureId: randomUUID(), name: 'General' },
      'Geral',
    ),
    'General',
    'Non-default Features keep their exact title',
  );
});

test('creating terminals from Sem Feature creates or reuses the default Feature and switches the view in one transaction', async () => {
  const f = preparationFixture('pt-BR');
  try {
    const features = featureConfigurationDatabase(f.preferencesDirectory, f.workspaceId);
    const defaultId = defaultFeatureId(f.workspaceId);
    assert.equal(features.readView().featureId, null);
    assert.equal(features.list().length, 0);

    const catalog = await prepareTauriTerminals(
      { action: 'catalog', workspaceId: f.workspaceId, featureId: null },
      f.context,
      f.ports,
      Date.now,
      f.trusted,
    );
    assert.equal(catalog.status, 'catalog');

    const batch = await prepareTauriTerminals(
      {
        action: 'create-batch',
        workspaceId: f.workspaceId,
        featureId: null,
        catalogId: catalog.catalog.catalogId,
        requests: [
          {
            id: randomUUID(),
            workspaceId: f.workspaceId,
            provider: 'codex',
            modelId: null,
            name: 'Codex 1',
          },
          {
            id: randomUUID(),
            workspaceId: f.workspaceId,
            provider: 'opencode',
            modelId: null,
            name: 'OpenCode 1',
          },
          {
            id: randomUUID(),
            workspaceId: f.workspaceId,
            provider: 'antigravity',
            modelId: null,
            name: 'Antigravity 1',
          },
        ],
      },
      f.context,
      f.ports,
      Date.now,
      f.trusted,
    );
    assert.equal(batch.status, 'batch');
    assert.ok(batch.items.every((item) => item.status === 'prepared'));

    const viewAfterBatch = features.readView();
    assert.equal(viewAfterBatch.featureId, defaultId, 'Studio tab switches to default Feature');
    const createdDefault = features.read(defaultId);
    assert.equal(createdDefault.name, 'Geral');
    assert.equal(createdDefault.status, 'active');
    assert.equal(createdDefault.terminalIds.length, 3);

    for (const item of batch.items) {
      assert.equal(item.status, 'prepared');
      const config = readInteractiveTerminalConfig(item.file!);
      assert.equal(config.preparation?.featureId, defaultId);
      assert.ok(createdDefault.terminalIds.includes(config.identity!.terminalId));
      validateTerminalPreparationBinding(config.preparation, f.project);
    }
    const agyConfig = readInteractiveTerminalConfig(batch.items[2]!.file!);
    assert.equal(agyConfig.version, 4);
    assert.equal('hub' in agyConfig.interactive, false);

    // Rename the default Feature, switch back to Sem Feature, and create another terminal:
    // the same stable default Feature ID is reused and its custom title + layout are preserved.
    const renamed = features.update(defaultId, {
      expectedRevision: createdDefault.revision,
      name: 'Principal',
    });
    const [t1, t2, tAgy] = renamed.terminalIds as [string, string, string];
    features.saveLayout(defaultId, {
      version: 1,
      order: [t2, t1, tAgy],
      shown: [t2, t1, tAgy],
      active: t2,
      maximized: null,
      axis: 'columns',
      columns: 2,
      percent: 50,
      names: [],
    });
    features.saveView({ expectedRevision: viewAfterBatch.revision, featureId: null });
    assert.equal(features.readView().featureId, null);

    const catalogAgain = await prepareTauriTerminals(
      { action: 'catalog', workspaceId: f.workspaceId, featureId: null },
      f.context,
      f.ports,
      Date.now,
      f.trusted,
    );
    assert.equal(catalogAgain.status, 'catalog');
    const codexModelId = catalogAgain.catalog.providers.find((entry) => entry.provider === 'codex')!
      .models[0]!.id;
    const selected = await prepareTauriTerminals(
      {
        action: 'create-selected',
        workspaceId: f.workspaceId,
        featureId: null,
        catalogId: catalogAgain.catalog.catalogId,
        provider: 'codex',
        modelId: codexModelId,
        count: 1,
      },
      f.context,
      f.ports,
      Date.now,
      f.trusted,
    );
    assert.equal(selected.status, 'open');
    const fourthConfig = readInteractiveTerminalConfig(selected.files[0]!);
    const t4 = fourthConfig.identity!.terminalId;
    assert.equal(fourthConfig.preparation?.featureId, defaultId);
    validateTerminalPreparationBinding(fourthConfig.preparation, f.project);
    assert.equal(features.readView().featureId, defaultId);
    const reused = features.read(defaultId);
    assert.equal(reused.name, 'Principal');
    assert.deepEqual(reused.terminalIds, [t1, t2, tAgy, t4]);
    assert.deepEqual(features.readLayout(defaultId)?.order, [t2, t1, tAgy, t4]);
  } finally {
    f.close();
  }
});

test('mentions (composer and structured @handles) resolve inside the default Feature like any other', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-default-mentions-')));
  chmodSync(root, 0o700);
  try {
    const workspaceId = 'synthetic-workspace';
    const defaultId = defaultFeatureId(workspaceId);
    const t1 = '00000000-0000-4000-8000-0000000000a1';
    const t2 = '00000000-0000-4000-8000-0000000000b1';
    const tAgy = '00000000-0000-4000-8000-0000000000c1';
    const tUnassigned = '00000000-0000-4000-8000-0000000000e1';
    const features = featureConfigurationDatabase(root, workspaceId);
    const { feature } = features.assignToOpenOrDefault(null, [t1, t2, tAgy], 'General');
    assert.equal(feature.featureId, defaultId);

    const parsed = resolveMentions('Please sync @T-001 and @T-002', [
      {
        id: t1,
        label: 'T-001',
        name: 'Codex',
        provider: 'codex',
        status: 'running',
        workspace: { id: workspaceId, name: 'Synthetic' },
      },
      {
        id: t2,
        label: 'T-002',
        name: 'OpenCode',
        provider: 'opencode',
        status: 'running',
        workspace: { id: workspaceId, name: 'Synthetic' },
      },
    ]);
    assert.deepEqual(
      parsed.map((item) => item.id),
      [t1, t2],
    );

    // Antigravity (tAgy, T-003) has hub: false so host.ts omits it from hubSlots;
    // unassigned hub terminals keep featureId: null.
    const hub = new TerminalMessageHub(
      () => [
        {
          terminalId: t1,
          alias: 'T-001',
          name: 'Codex',
          provider: 'codex',
          featureId: defaultId,
          running: true,
        },
        {
          terminalId: t2,
          alias: 'T-002',
          name: 'OpenCode',
          provider: 'opencode',
          featureId: defaultId,
          running: true,
        },
        {
          terminalId: tUnassigned,
          alias: 'T-004',
          name: 'Codex',
          provider: 'codex',
          featureId: null,
          running: true,
        },
      ],
      () => {},
    );
    await assert.rejects(
      hub.call(t1, { name: 'send_message', arguments: { to: '@T-003', text: 'to non-hub agy' } }),
      (error: unknown) => error instanceof HubRefusal && error.code === 'unknown_terminal',
    );
    await assert.rejects(
      hub.call(tUnassigned, {
        name: 'delegate_task',
        arguments: { to: '@T-003', task: 'from unassigned' },
      }),
      (error: unknown) => error instanceof HubRefusal && error.code === 'sender_unassigned',
    );
    const ownerMention = recordComposerMention(
      root,
      workspaceId,
      defaultId,
      [t1, t2],
      { from: { kind: 'user' }, to: [t2], text: 'Check API schema' },
      (targetId, text) => {
        hub.ownerSend(defaultId, targetId, text);
        return { delivery: 'queued', reason: 'hub_inbox' };
      },
    );
    assert.deepEqual(ownerMention.outcomes, [
      { terminalId: t2, delivery: 'queued', reason: 'hub_inbox' },
    ]);
    const inbox = (await hub.call(t2, { name: 'read_messages', arguments: {} })) as {
      messages: { from: string; text: string }[];
    };
    assert.deepEqual(
      inbox.messages.map(({ from, text }) => ({ from, text })),
      [{ from: 'owner', text: 'Check API schema' }],
    );

    await hub.call(t1, {
      name: 'send_message',
      arguments: { to: '@T-002', text: 'Hello inside General' },
    });
    const peerInbox = (await hub.call(t2, { name: 'read_messages', arguments: {} })) as {
      messages: { from: string; text: string }[];
    };
    assert.equal(peerInbox.messages[0]?.from, 'T-001');
    assert.equal(peerInbox.messages[0]?.text, 'Hello inside General');

    // Structured @mention resolution inside the default Feature scope:
    const scope = { workspaceId, featureId: defaultId };
    const s1 = '00000000-0000-4000-8000-0000000000c1';
    const s2 = '00000000-0000-4000-8000-0000000000d1';
    const sessions: StructuredAgentsSnapshot['sessions'] = [
      {
        sessionId: s1,
        label: 'codex',
        workspaceId,
        featureId: defaultId,
        provider: 'codex',
        lifecycle: 'ready',
        reportedModel: null,
        threadId: 'thread-1',
        exit: null,
        items: [],
        droppedItems: 0,
        approvals: [],
        turn: null,
        busy: false,
      },
      {
        sessionId: s2,
        label: 'opencode',
        workspaceId,
        featureId: defaultId,
        provider: 'opencode',
        lifecycle: 'ready',
        reportedModel: null,
        threadId: 'thread-2',
        exit: null,
        items: [],
        droppedItems: 0,
        approvals: [],
        turn: null,
        busy: false,
      },
    ];
    assert.deepEqual(
      structuredMentionGrant(scope, sessions, {
        action: 'mention',
        sourceSessionId: s1,
        targetSessionId: s2,
        handle: '@opencode',
        task: 'Review diff',
      }),
      {
        action: 'grant',
        sourceSessionId: s1,
        targetSessionId: s2,
        task: 'Review diff',
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('existing unassigned terminals stay untouched, render localized notice + Move to Feature, preserve layout, and Structured agents selects default Feature', async () => {
  const uiBundle = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { createInstance } from 'i18next';
        import { I18nextProvider } from 'react-i18next';
        import { FeatureWorkspace } from './src/FeatureWorkspace.tsx';
        import { defaultFeatureId, featureNativeSnapshotSchema } from '@orqst/protocol';
        import en from './src/locales/en-US.json';
        import pt from './src/locales/pt-BR.json';

        window.startFixture = async (language) => {
          const workspaceId = 'synthetic-workspace';
          const defaultId = defaultFeatureId(workspaceId);
          const t1 = '00000000-0000-4000-8000-000000000011';
          const t2 = '00000000-0000-4000-8000-000000000012';
          let generation = 1;
          let viewRevision = 0;
          let activeFeatureId = null;
          let features = [];
          const requests = [];
          window.requests = requests;
          window.structuredScopes = [];
          window.layouts = [];

          const buildSnapshot = () =>
            featureNativeSnapshotSchema.parse({
              contractVersion: 1,
              storage: 'core',
              generation,
              workspace: { id: workspaceId, name: 'Synthetic Project' },
              features,
              view: {
                contractVersion: 1,
                storage: 'core',
                workspaceId,
                featureId: activeFeatureId,
                revision: viewRevision,
              },
              activeFeatureId,
              slots: [
                { slot: 0, terminalId: t1, provider: 'codex' },
                { slot: 1, terminalId: t2, provider: 'opencode' },
              ],
              layoutSaved: true,
            });

          const ensureDefault = () => {
            let entry = features.find((item) => item.featureId === defaultId);
            if (!entry) {
              entry = {
                schemaVersion: 1,
                workspaceId,
                featureId: defaultId,
                name: 'General',
                description: '',
                status: 'active',
                revision: 1,
                terminalIds: [],
                createdAt: 1,
                updatedAt: 1,
              };
              features = [...features, entry];
            }
            return entry;
          };

          window.orqstFeatures = {
            contractVersion: 1,
            arrange: async (payload) => {
              window.layouts.push(payload);
              return { status: 'ok' };
            },
            request: async (req) => {
              requests.push(req);
              if (req.action === 'snapshot') return { status: 'ok', snapshot: buildSnapshot() };
              if (req.action === 'assign') {
                const slot = req.slot === 0 ? t1 : t2;
                const entry = ensureDefault();
                features = features.map((item) =>
                  item.featureId === entry.featureId
                    ? {
                        ...item,
                        revision: item.revision + 1,
                        terminalIds: [...item.terminalIds, slot],
                      }
                    : item,
                );
                generation += 1;
                return { status: 'ok', snapshot: buildSnapshot() };
              }
              if (req.action === 'select') {
                if (req.featureId === defaultId) ensureDefault();
                activeFeatureId = req.featureId;
                viewRevision += 1;
                generation += 1;
                return { status: 'ok', snapshot: buildSnapshot() };
              }
              if (req.action === 'mention') {
                return {
                  status: 'ok',
                  snapshot: buildSnapshot(),
                  mention: {
                    id: '00000000-0000-4000-8000-000000000099',
                    outcomes: req.to.map((terminalId) => ({
                      terminalId,
                      delivery: 'queued',
                      reason: 'hub_inbox',
                    })),
                  },
                };
              }
              return { status: 'ok', snapshot: buildSnapshot() };
            },
          };

          window.orqstStructuredAgents = {
            request: async (scope) => {
              window.structuredScopes.push(scope);
              return {
                status: 'ok',
                snapshot: { contractVersion: 1, sessions: [], grants: [] },
              };
            },
            prepare: async () => ({ status: 'denied' }),
            apply: async () => ({ status: 'denied' }),
          };

          const i18n = createInstance();
          await i18n.init({
            lng: language,
            fallbackLng: 'en-US',
            resources: { 'en-US': { translation: en }, 'pt-BR': { translation: pt } },
          });
          createRoot(document.getElementById('root')).render(
            <I18nextProvider i18n={i18n}>
              <FeatureWorkspace nativeWorkspace />
            </I18nextProvider>,
          );
          window.dispatchEvent(
            new CustomEvent('orqst-terminal-dock', {
              detail: {
                generation: 1,
                panes: [
                  { slot: 0, label: 'Codex', minimized: false, focused: true, maximized: false },
                  { slot: 1, label: 'OpenCode', minimized: false, focused: false, maximized: false },
                ],
              },
            }),
          );
        };
      `,
      resolveDir: resolve('apps/dashboard'),
      loader: 'tsx',
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'safari17',
    loader: { '.css': 'empty' },
    write: false,
    logLevel: 'silent',
  });
  const css = await build({
    entryPoints: [
      resolve('apps/dashboard/src/feature-workspace.css'),
      resolve('apps/dashboard/src/terminal-studio.css'),
      resolve('apps/dashboard/src/pane-menu.css'),
      resolve('apps/dashboard/src/mention-composer.css'),
    ],
    bundle: true,
    write: false,
    logLevel: 'silent',
    outdir: 'out',
  });

  const browser = await chromium.launch({ headless: true });
  try {
    for (const [language, noticeText, moveText, defaultTab, structuredLabel, mentionOpen] of [
      [
        'en-US',
        'This terminal is not in a Feature, so it cannot talk to other terminals',
        'Move to Feature',
        'General',
        'Structured agents',
        'Mention a terminal',
      ],
      [
        'pt-BR',
        'Este terminal não está em uma Feature, então não pode conversar com outros terminais',
        'Mover para Feature',
        'Geral',
        'Agentes estruturados',
        'Mencionar um terminal',
      ],
    ] as const) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.setContent(
        '<style>html,body,#root{margin:0;width:100%;height:100%;}</style><div id="root"></div>',
      );
      for (const file of css.outputFiles) await page.addStyleTag({ content: file.text });
      await page.addScriptTag({ content: uiBundle.outputFiles[0]!.text });
      await page.evaluate((lng) => Reflect.get(window, 'startFixture')(lng), language);

      // 1. Existing unassigned terminals stay untouched on Sem Feature / Unassigned and show notice + Move button.
      const notices = page.locator('.ts-unassigned');
      await notices.first().waitFor({ state: 'visible' });
      assert.equal(await notices.count(), 2);
      assert.match((await notices.first().textContent()) ?? '', new RegExp(noticeText));
      assert.equal(
        await page.locator('.ts-mention-open').count(),
        0,
        'no mention composer outside a Feature',
      );

      // Native PTY hole stays strictly below the unassigned banner.
      const geometry = await page.evaluate(() => {
        const banner = document.querySelector('.ts-unassigned')!.getBoundingClientRect();
        const body = document.querySelector('.ts-body')!.getBoundingClientRect();
        return { bannerBottom: banner.bottom, bodyTop: body.top, bodyHeight: body.height };
      });
      assert.ok(geometry.bodyTop >= geometry.bannerBottom - 1);
      assert.ok(geometry.bodyHeight > 100);

      // 2. Move first terminal -> T-002 stays on Sem Feature; move second terminal -> tab switches to General / Geral!
      await page.getByRole('button', { name: moveText, exact: true }).first().click();
      await page.waitForFunction(() => document.querySelectorAll('.ts-unassigned').length === 1);
      await page.getByRole('button', { name: moveText, exact: true }).click();
      const tab = page.locator('.ts-features button.active');
      await tab.waitFor({ state: 'visible' });
      assert.match((await tab.textContent()) ?? '', new RegExp(`^${defaultTab}`));
      assert.equal(await page.locator('.ts-unassigned').count(), 0);
      assert.equal(await page.locator('.ts-mention-open').count(), 1);
      assert.match(
        (await page.locator('.ts-mention-open').textContent()) ?? '',
        new RegExp(mentionOpen),
      );

      // MentionComposer resolves @T-002 inside the new default Feature and dispatches a queued mention.
      await page.locator('.ts-mention-open').click();
      const composerBox = page.locator('.mc-field textarea');
      await composerBox.waitFor({ state: 'visible' });
      await composerBox.fill('Check @T-002 now');
      await page.locator('.mc-send').click();
      await page.waitForFunction(() =>
        (Reflect.get(window, 'requests') as { action: string }[]).some(
          (entry) => entry.action === 'mention',
        ),
      );
      const mentionCalls = (
        (await page.evaluate(() => Reflect.get(window, 'requests'))) as {
          action: string;
          to?: string[];
        }[]
      ).filter((entry) => entry.action === 'mention');
      assert.deepEqual(mentionCalls[0]?.to, ['00000000-0000-4000-8000-000000000012']);

      await page.close();

      // 3. Opening Structured agents directly from Sem Feature selects/creates General / Geral first.
      const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page2.setContent(
        '<style>html,body,#root{margin:0;width:100%;height:100%;}</style><div id="root"></div>',
      );
      for (const file of css.outputFiles) await page2.addStyleTag({ content: file.text });
      await page2.addScriptTag({ content: uiBundle.outputFiles[0]!.text });
      await page2.evaluate((lng) => Reflect.get(window, 'startFixture')(lng), language);
      await page2.locator('.ts-panel-toggle').click();
      await page2.getByRole('button', { name: structuredLabel, exact: true }).click();
      await page2.waitForFunction(
        () => (Reflect.get(window, 'structuredScopes') as unknown[]).length > 0,
      );
      const scopes = (await page2.evaluate(() => Reflect.get(window, 'structuredScopes'))) as {
        workspaceId: string;
        featureId: string;
      }[];
      assert.equal(scopes[0]?.featureId, defaultFeatureId('synthetic-workspace'));
      await page2.close();
    }
  } finally {
    await browser.close();
  }
});
