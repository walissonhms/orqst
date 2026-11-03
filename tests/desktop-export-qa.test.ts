// Independent native Analytics export QA. Temporary files only; no Electron or user data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyticsExportLimits,
  type AnalyticsReading,
  type ModelAnalyticsSummary,
} from '@orqst/protocol';
import { canonicalModelAnalytics, serializeModelAnalytics } from '../apps/analytics-export.js';
import {
  AnalyticsSaver,
  nativeAnalyticsTimeoutMs,
  readNativeAnalytics,
  type AnalyticsSaveDependencies,
} from '../apps/desktop/src/analytics.js';

const usage = { input: 100, output: 20, cached: 40, total: 120 };

function report(overrides: Partial<ModelAnalyticsSummary> = {}): ModelAnalyticsSummary {
  return {
    contract: 'orqst.model-analytics',
    contractVersion: 1,
    query: {},
    basis: {
      tokens: 'retained_canonical_snapshot_deltas',
      period: 'fully_contained_intervals_half_open',
      workspace: 'current_session_assignment',
      sessions: 'observed_sessions_non_additive_across_models',
      comparison: 'descriptive_only',
    },
    usage,
    sessions: 2,
    models: [
      {
        adapter: 'codex',
        provider: null,
        model: 'synthetic-alpha',
        sessions: 1,
        usage: { input: 60, output: 10, cached: 20, total: 70 },
      },
      {
        adapter: 'codex',
        provider: null,
        model: null,
        sessions: 1,
        usage: { input: 40, output: 10, cached: 20, total: 50 },
      },
    ],
    coverage: {
      scope: 'before_model_filter',
      complete: false,
      reason: 'source_coverage_unverified',
      sessions: 2,
      sessionsWithCanonicalUsage: 2,
      unidentifiedContributions: 1,
      gaps: [{ reason: 'usage_not_reported', count: 1 }],
    },
    unavailable: {
      provider: 'not_recorded',
      reasoningTokens: 'not_recorded',
      executions: 'not_recorded',
      duration: 'not_measured',
      successRate: 'task_outcomes_not_recorded',
      tokensPerExecution: 'executions_not_recorded',
      tokensPerCompletedTask: 'equivalent_tasks_not_recorded',
      cost: 'verified_prices_and_billing_not_recorded',
      taskEquivalence: 'not_recorded',
    },
    ...overrides,
  };
}

const digestOf = (value: ModelAnalyticsSummary) =>
  createHash('sha256').update(canonicalModelAnalytics(value)).digest('hex');

function reading(value = report(), overrides: Partial<AnalyticsReading> = {}): AnalyticsReading {
  return {
    query: {},
    ranking: 'tokens',
    cursor: 7,
    obtainedAt: '2026-11-02T12:00:00.000Z',
    readingId: randomUUID(),
    digest: digestOf(value),
    ...overrides,
  };
}

const saveInput = (
  value: AnalyticsReading,
  generation = 1,
  format: 'csv' | 'markdown' = 'csv',
) => ({ contractVersion: 1 as const, action: 'save' as const, generation, reading: value, format });

const contextInput = (value: AnalyticsReading | null, generation = 1) => ({
  contractVersion: 1 as const,
  action: 'context' as const,
  generation,
  reading: value,
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-native-export-qa-'));
  return {
    dir,
    path: join(dir, 'report.csv'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function deps(overrides: Partial<AnalyticsSaveDependencies> = {}): AnalyticsSaveDependencies {
  return {
    document: 1,
    authorized: () => true,
    read: async () => report(),
    choose: async () => undefined,
    confirm: async () => false,
    ...overrides,
  };
}

test('context generations are monotonic, consumed by save, and never reauthorize', async () => {
  const saver = new AnalyticsSaver();
  const value = reading();
  assert.deepEqual(saver.context(contextInput(value, 2), 1), { status: 'acknowledged' });
  // Older or equal generations never re-authorize.
  assert.deepEqual(saver.context(contextInput(value, 2), 1), { status: 'failed' });
  assert.deepEqual(saver.context(contextInput(value, 1), 1), { status: 'failed' });
  // A different document starts a new generation space and drops the reading.
  assert.deepEqual(saver.context(contextInput(value, 1), 2), { status: 'acknowledged' });

  const dir = tempDir();
  try {
    const saved = await saver.save(
      saveInput(value, 1),
      deps({ document: 2, choose: async () => dir.path }),
    );
    assert.deepEqual(saved, { status: 'saved' });
    // The save consumed the context: the same generation cannot export again.
    const again = await saver.save(
      saveInput(value, 1),
      deps({ document: 2, choose: async () => dir.path }),
    );
    assert.deepEqual(again, { status: 'stale' });
  } finally {
    dir.cleanup();
  }
});

test('context progresses while a save waits for the dialog and revokes the write', async () => {
  const saver = new AnalyticsSaver();
  const value = reading();
  const dir = tempDir();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    saver.context(contextInput(value, 1), 1);
    const pending = saver.save(
      saveInput(value, 1),
      deps({
        choose: async () => {
          await gate;
          return dir.path;
        },
      }),
    );
    // Invalidation must not be blocked behind the active save.
    assert.deepEqual(saver.context(contextInput(null, 2), 1), { status: 'acknowledged' });
    release();
    assert.deepEqual(await pending, { status: 'stale' });
    assert.throws(() => readFileSync(dir.path), /ENOENT/);
  } finally {
    dir.cleanup();
  }
});

test('a consumed reading cannot be reauthorized by a new generation or ranking change', async () => {
  const saver = new AnalyticsSaver();
  const value = reading();
  saver.context(contextInput(value, 1), 1);
  // Cancelled saves still consume the reading: no second attempt from the same response.
  assert.deepEqual(await saver.save(saveInput(value, 1), deps()), { status: 'cancelled' });

  assert.deepEqual(saver.context(contextInput(value, 2), 1), { status: 'failed' });
  assert.deepEqual(await saver.save(saveInput(value, 2), deps()), { status: 'stale' });

  // Changing only the ranking keeps the same response and must not re-enable export.
  const reranked = { ...value, ranking: 'sessions' as const };
  assert.deepEqual(saver.context(contextInput(reranked, 3), 1), { status: 'failed' });
  assert.deepEqual(await saver.save(saveInput(reranked, 3), deps()), { status: 'stale' });

  // Only a new response (new readingId) can be acknowledged again.
  const fresh = reading();
  assert.deepEqual(saver.context(contextInput(fresh, 4), 1), { status: 'acknowledged' });
  assert.deepEqual(await saver.save(saveInput(fresh, 4), deps()), { status: 'cancelled' });
});

test('a second save while one is active returns busy and the first still fails closed', async () => {
  const saver = new AnalyticsSaver();
  const first = reading();
  const second = reading();
  const dir = tempDir();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    saver.context(contextInput(first, 1), 1);
    const pending = saver.save(
      saveInput(first, 1),
      deps({
        choose: async () => {
          await gate;
          return dir.path;
        },
      }),
    );
    saver.context(contextInput(second, 2), 1);
    assert.deepEqual(await saver.save(saveInput(second, 2), deps()), { status: 'busy' });
    release();
    assert.deepEqual(await pending, { status: 'stale' });
    assert.throws(() => readFileSync(dir.path), /ENOENT/);
    // The shared claim is released even when the operation fails.
    let claimed = 0;
    let released = 0;
    const claimedSaver = new AnalyticsSaver();
    claimedSaver.context(contextInput(second, 1), 1);
    await claimedSaver.save(
      saveInput(second, 1),
      deps({
        claim: () => {
          claimed += 1;
          return () => {
            released += 1;
          };
        },
      }),
    );
    assert.equal(claimed, 1);
    assert.equal(released, 1);
    const busyClaim = new AnalyticsSaver();
    busyClaim.context(contextInput(second, 1), 1);
    assert.deepEqual(await busyClaim.save(saveInput(second, 1), deps({ claim: () => undefined })), {
      status: 'busy',
    });
  } finally {
    dir.cleanup();
  }
});

test('save requires the exact registered reading and a fresh matching document', async () => {
  const saver = new AnalyticsSaver();
  const value = reading();
  saver.context(contextInput(value, 1), 1);
  const tampered: Array<Partial<AnalyticsReading>> = [
    { readingId: randomUUID() },
    { ranking: 'sessions' },
    { obtainedAt: '2026-11-02T12:00:01.000Z' },
    { cursor: 8 },
    { digest: 'b'.repeat(64) },
    { query: { adapter: 'codex' } },
  ];
  for (const change of tampered) {
    const fresh = new AnalyticsSaver();
    fresh.context(contextInput(value, 1), 1);
    const result = await fresh.save(saveInput({ ...value, ...change }), deps());
    assert.deepEqual(result, { status: 'stale' }, JSON.stringify(change));
  }
  // Wrong document, missing context, malformed input and revoked sender never export.
  assert.deepEqual(await saver.save(saveInput(value, 1), deps({ document: 2 })), {
    status: 'stale',
  });
  assert.deepEqual(await new AnalyticsSaver().save(saveInput(value, 1), deps()), {
    status: 'stale',
  });
  assert.deepEqual(await saver.save({ ...saveInput(value, 1), path: '/tmp/x.csv' }, deps()), {
    status: 'failed',
  });
  const revoked = new AnalyticsSaver();
  revoked.context(contextInput(value, 1), 1);
  assert.deepEqual(await revoked.save(saveInput(value, 1), deps({ authorized: () => false })), {
    status: 'failed',
  });
});

test('ranking, query, cursor, connection and navigate-back revoke during choose and confirm', async () => {
  type Invalidation = [
    string,
    (saver: AnalyticsSaver, value: AnalyticsReading, deps: AnalyticsSaveDependencies) => void,
  ];
  const invalidations: Invalidation[] = [
    [
      'ranking',
      (saver, value) => saver.context(contextInput({ ...value, ranking: 'sessions' }, 2), 1),
    ],
    [
      'query',
      (saver, value) =>
        saver.context(contextInput({ ...value, query: { adapter: 'codex' } }, 2), 1),
    ],
    ['cursor', (saver, value) => saver.context(contextInput({ ...value, cursor: 8 }, 2), 1)],
    ['connection', (saver) => saver.context(contextInput(null, 2), 1)],
    [
      'navigate-back',
      (saver, _value, current) => {
        current.document = 2;
        saver.context(contextInput(null, 2), 2);
      },
    ],
  ];
  for (const timing of ['choose', 'confirm'] as const) {
    for (const [label, invalidate] of invalidations) {
      const dir = tempDir();
      try {
        const saver = new AnalyticsSaver();
        const value = reading();
        saver.context(contextInput(value, 1), 1);
        if (timing === 'confirm') writeFileSync(dir.path, 'previous content');
        const current = deps();
        current.choose = async () => {
          if (timing === 'choose') invalidate(saver, value, current);
          return dir.path;
        };
        current.confirm = async () => {
          if (timing === 'confirm') invalidate(saver, value, current);
          return true;
        };
        const result = await saver.save(saveInput(value, 1), current);
        assert.deepEqual(result, { status: 'stale' }, `${timing}:${label}`);
        if (timing === 'confirm') assert.equal(readFileSync(dir.path, 'utf8'), 'previous content');
        else assert.throws(() => readFileSync(dir.path), /ENOENT/);
      } finally {
        dir.cleanup();
      }
    }
  }
});

test('a late or older context cannot disturb or extend the active save', async () => {
  const dir = tempDir();
  try {
    const saver = new AnalyticsSaver();
    const value = reading();
    saver.context(contextInput(value, 2), 1);
    const current = deps({
      choose: async () => {
        // Stale publication arriving while the dialog is open is ignored, not applied.
        assert.deepEqual(saver.context(contextInput(value, 2), 1), { status: 'failed' });
        assert.deepEqual(saver.context(contextInput(value, 1), 1), { status: 'failed' });
        return dir.path;
      },
    });
    assert.deepEqual(await saver.save(saveInput(value, 2), current), { status: 'saved' });
    assert.equal(readFileSync(dir.path, 'utf8').startsWith('"\'section"'), true);
  } finally {
    dir.cleanup();
  }
});

test('aggregate divergence fails closed on the first and on the last read', async () => {
  const value = reading();
  const changed = report({
    models: [{ ...report().models[0]!, model: 'synthetic-beta' }, report().models[1]!],
  });
  const dir = tempDir();
  try {
    // First read already diverges from the displayed digest.
    const first = new AnalyticsSaver();
    first.context(contextInput(value, 1), 1);
    assert.deepEqual(
      await first.save(
        saveInput(value, 1),
        deps({ read: async () => changed, choose: async () => dir.path }),
      ),
      { status: 'stale' },
    );
    assert.throws(() => readFileSync(dir.path), /ENOENT/);

    // Last read diverges after the dialogs: no bytes are written.
    const last = new AnalyticsSaver();
    last.context(contextInput(value, 1), 1);
    let calls = 0;
    const result = await last.save(
      saveInput(value, 1),
      deps({
        read: async () => {
          calls += 1;
          return calls === 1 ? report() : changed;
        },
        choose: async () => dir.path,
      }),
    );
    assert.deepEqual(result, { status: 'stale' });
    assert.equal(calls, 2);
    assert.throws(() => readFileSync(dir.path), /ENOENT/);
  } finally {
    dir.cleanup();
  }
});

test('native IPC and preload keep narrow file/export/view channels and no generic filesystem', async () => {
  const { readFile } = await import('node:fs/promises');
  const main = await readFile('apps/desktop/src/main.ts', 'utf8');
  const preload = await readFile('apps/desktop/src/preload.ts', 'utf8');
  assert.deepEqual(
    [...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((match) => match[1]).sort(),
    ['orqst:analytics-export', 'orqst:managed-agents-open', 'orqst:save-markdown'],
  );
  const handler = main.slice(
    main.indexOf("ipcMain.handle('orqst:analytics-export'"),
    main.indexOf("ipcMain.handle('orqst:analytics-export'") + 4000,
  );
  for (const required of [
    'authorizedArtifactSender',
    'documentGeneration',
    'nativeFileBusy',
    'dialog.showSaveDialog',
    "action === 'context'",
    'analyticsSaver.save',
  ])
    assert.equal(handler.includes(required), true, required);
  for (const forbidden of ['shell.', 'openPath', 'exec(', 'spawn(', 'node:fs', 'console.'])
    assert.equal(handler.includes(forbidden), false, forbidden);
  assert.equal(preload.includes("ipcRenderer.invoke('orqst:analytics-export'"), true);
  assert.equal(preload.includes("exposeInMainWorld('orqstAnalytics'"), true);
  for (const forbidden of ['readFileSync', 'writeFileSync', 'child_process', 'shell.', 'node:fs'])
    assert.equal(preload.includes(forbidden), false, forbidden);
});

test('cancel, revocation during dialogs and extension mismatch never touch the destination', async () => {
  const dir = tempDir();
  try {
    const value = reading();
    const cancelled = new AnalyticsSaver();
    cancelled.context(contextInput(value, 1), 1);
    assert.deepEqual(
      await cancelled.save(saveInput(value, 1), deps({ choose: async () => undefined })),
      { status: 'cancelled' },
    );
    assert.throws(() => readFileSync(dir.path), /ENOENT/);

    for (const extension of ['report.txt', 'report', 'report.csv.md']) {
      const saver = new AnalyticsSaver();
      saver.context(contextInput(value, 1), 1);
      const result = await saver.save(
        saveInput(value, 1),
        deps({ choose: async () => join(dir.dir, extension) }),
      );
      assert.deepEqual(result, { status: 'failed' }, extension);
    }

    // Revocation while the save dialog is open.
    let allow = true;
    const revoked = new AnalyticsSaver();
    revoked.context(contextInput(value, 1), 1);
    const result = await revoked.save(
      saveInput(value, 1),
      deps({
        authorized: () => allow,
        choose: async () => {
          allow = false;
          return dir.path;
        },
      }),
    );
    assert.deepEqual(result, { status: 'stale' });
    assert.throws(() => readFileSync(dir.path), /ENOENT/);
  } finally {
    dir.cleanup();
  }
});

test('overwrite needs explicit confirmation and target swaps fail closed', async () => {
  const dir = tempDir();
  try {
    const value = reading();
    writeFileSync(dir.path, 'previous content');
    const denied = new AnalyticsSaver();
    denied.context(contextInput(value, 1), 1);
    assert.deepEqual(
      await denied.save(
        saveInput(value, 1),
        deps({ choose: async () => dir.path, confirm: async () => false }),
      ),
      { status: 'cancelled' },
    );
    assert.equal(readFileSync(dir.path, 'utf8'), 'previous content');

    const allowed = new AnalyticsSaver();
    allowed.context(contextInput(value, 1), 1);
    assert.deepEqual(
      await allowed.save(
        saveInput(value, 1),
        deps({ choose: async () => dir.path, confirm: async () => true }),
      ),
      { status: 'saved' },
    );
    assert.equal(
      readFileSync(dir.path, 'utf8'),
      serializeModelAnalytics(report(), {
        format: 'csv',
        ranking: 'tokens',
        obtainedAt: value.obtainedAt,
        query: {},
      }).text,
    );

    // The path is replaced between confirmation and write.
    const swap = join(dir.dir, 'swap.csv');
    writeFileSync(swap, 'original');
    const swapped = new AnalyticsSaver();
    swapped.context(contextInput(value, 1), 1);
    const result = await swapped.save(
      saveInput(value, 1),
      deps({
        choose: async () => swap,
        confirm: async () => {
          rmSync(swap);
          writeFileSync(swap, 'replacement');
          return true;
        },
      }),
    );
    assert.deepEqual(result, { status: 'failed' });
    assert.equal(readFileSync(swap, 'utf8'), 'replacement');
  } finally {
    dir.cleanup();
  }
});

test('symlinks, hardlinks, executables and oversized targets are rejected', async () => {
  const dir = tempDir();
  try {
    const value = reading();
    const target = join(dir.dir, 'target.csv');
    writeFileSync(target, 'target');
    const cases: Array<[string, () => string]> = [
      [
        'symlink',
        () => {
          const link = join(dir.dir, 'link.csv');
          symlinkSync(target, link);
          return link;
        },
      ],
      [
        'hardlink',
        () => {
          const hard = join(dir.dir, 'hard.csv');
          writeFileSync(hard, 'x');
          linkSync(hard, join(dir.dir, 'hard-alias.csv'));
          return hard;
        },
      ],
      [
        'executable',
        () => {
          const exec = join(dir.dir, 'exec.csv');
          writeFileSync(exec, 'x');
          chmodSync(exec, 0o755);
          return exec;
        },
      ],
      [
        'oversized',
        () => {
          const large = join(dir.dir, 'large.csv');
          writeFileSync(large, 'x'.repeat(analyticsExportLimits.outputBytes + 1));
          return large;
        },
      ],
    ];
    for (const [label, build] of cases) {
      const saver = new AnalyticsSaver();
      saver.context(contextInput(value, 1), 1);
      const result = await saver.save(
        saveInput(value, 1),
        deps({ choose: async () => build(), confirm: async () => true }),
      );
      assert.deepEqual(result, { status: 'failed' }, label);
    }
    assert.equal(readFileSync(target, 'utf8'), 'target');
  } finally {
    dir.cleanup();
  }
});

test('written bytes reuse the shared serializer: no identities, inert formulas, exact integers', async () => {
  const hostile = '=cmd|\' /C calc\'!A0 "q",x\r\n<script>[l](javascript:)';
  const big = {
    ...report(),
    usage: { input: 1000000000000000, output: 1, cached: 0, total: 1000000000000001 },
    models: [
      {
        adapter: 'codex' as const,
        provider: null,
        model: hostile,
        sessions: 1,
        usage: { input: 1000000000000000, output: 1, cached: 0, total: 1000000000000001 },
      },
      { adapter: 'codex' as const, provider: null, model: null, sessions: 0, usage: null },
    ],
    sessions: 1,
    coverage: {
      ...report().coverage,
      sessions: 1,
      sessionsWithCanonicalUsage: 1,
      unidentifiedContributions: 0,
      gaps: [],
    },
  };
  const value = reading(big);
  const dir = tempDir();
  try {
    const saver = new AnalyticsSaver();
    saver.context(contextInput(value, 1), 1);
    const saved = await saver.save(
      saveInput(value, 1),
      deps({ read: async () => big, choose: async () => dir.path }),
    );
    assert.deepEqual(saved, { status: 'saved' });
    const text = readFileSync(dir.path, 'utf8');
    assert.equal(
      text,
      serializeModelAnalytics(big, {
        format: 'csv',
        ranking: 'tokens',
        obtainedAt: value.obtainedAt,
        query: {},
      }).text,
    );
    assert.equal(text.includes("'int:1000000000000000"), true);
    assert.equal(text.includes('\r\nline'), false);
    assert.equal(text.includes('"\'null"'), true);
    for (const secret of ['workspace-', 'agent-', 'session-', '/Users/', 'synthetic-alpha'])
      assert.equal(text.includes(secret), false, secret);
  } finally {
    dir.cleanup();
  }
});

function fetcherFor(
  body: unknown,
  options: {
    cursorBefore?: number;
    cursorAfter?: number;
    status?: number;
    error?: unknown;
    seen?: string[];
    init?: RequestInit[];
  } = {},
) {
  const seen = options.seen ?? [];
  const init = options.init ?? [];
  return (async (url: string, request?: RequestInit) => {
    seen.push(String(url));
    init.push(request ?? {});
    if (options.status && options.status !== 200)
      return new Response(JSON.stringify(options.error ?? {}), {
        status: options.status,
        headers: { 'content-type': 'application/json' },
      });
    if (String(url).includes('/api/events'))
      return new Response(
        JSON.stringify({
          events: [],
          cursor:
            seen.filter((item) => item.includes('/api/events')).length === 1
              ? (options.cursorBefore ?? 7)
              : (options.cursorAfter ?? 7),
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

test('native revalidation uses the fixed cursor endpoint and the aggregate digest', async () => {
  const value = reading();
  const seen: string[] = [];
  const init: RequestInit[] = [];
  const authorized = () => true;
  const result = await readNativeAnalytics(
    fetcherFor(report(), { seen, init }),
    'http://127.0.0.1:1',
    value,
    authorized,
  );
  assert.deepEqual(result, report());
  assert.deepEqual(seen, [
    'http://127.0.0.1:1/api/events?after=9007199254740991&limit=1',
    'http://127.0.0.1:1/api/analytics/models?',
    'http://127.0.0.1:1/api/events?after=9007199254740991&limit=1',
  ]);
  for (const request of init) {
    assert.equal(request.redirect, 'error');
    assert.equal(request.credentials, 'include');
    assert.equal((request.headers as Record<string, string>).Origin, 'http://127.0.0.1:1');
  }
  assert.equal(nativeAnalyticsTimeoutMs, 15000);

  // Cursor moved before or after the aggregate: stale, never exported.
  for (const options of [{ cursorBefore: 8 }, { cursorAfter: 8 }])
    await assert.rejects(
      readNativeAnalytics(fetcherFor(report(), options), 'http://127.0.0.1:1', value, authorized),
      /stale/,
    );
  // Different aggregate with the same query: digest mismatch.
  const changed = report({
    models: [{ ...report().models[0]!, model: 'synthetic-beta' }, report().models[1]!],
  });
  await assert.rejects(
    readNativeAnalytics(fetcherFor(changed), 'http://127.0.0.1:1', value, authorized),
    /stale/,
  );
  // Worker busy, errors, non-JSON and revocation map to bounded statuses.
  await assert.rejects(
    readNativeAnalytics(
      fetcherFor({}, { status: 503, error: { error: 'analytics_busy' } }),
      'http://127.0.0.1:1',
      value,
      authorized,
    ),
    /busy/,
  );
  await assert.rejects(
    readNativeAnalytics(
      fetcherFor({}, { status: 503, error: { error: 'other' } }),
      'http://127.0.0.1:1',
      value,
      authorized,
    ),
    /unavailable/,
  );
  await assert.rejects(
    readNativeAnalytics(fetcherFor({}, { status: 500 }), 'http://127.0.0.1:1', value, authorized),
    /unavailable/,
  );
  await assert.rejects(
    readNativeAnalytics(
      (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
      'http://127.0.0.1:1',
      value,
      authorized,
    ),
    /unavailable/,
  );
  await assert.rejects(
    readNativeAnalytics(fetcherFor(report()), 'http://127.0.0.1:1', value, () => false),
    /stale/,
  );
  // Oversized cursor body is rejected by the fixed 4 KiB bound.
  const oversized = (async (url: string) =>
    new Response(
      String(url).includes('/api/events') ? 'x'.repeat(4097) : JSON.stringify(report()),
      { headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;
  await assert.rejects(
    readNativeAnalytics(oversized, 'http://127.0.0.1:1', value, authorized),
    /unavailable/,
  );
});

test('the native path has no shell, no logging of readings and no caller path', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile('apps/desktop/src/analytics.ts', 'utf8');
  for (const forbidden of ['shell.', 'openPath', 'exec(', 'spawn(', 'console.', 'process.env'])
    assert.equal(source.includes(forbidden), false, forbidden);
  assert.equal(source.includes("'/api/events?after=9007199254740991&limit=1'"), true);
  assert.equal(source.includes("redirect: 'error'"), true);
  assert.equal(source.includes('analyticsExportLimits.responseBytes'), true);
  // Cursor comes from the fixed events endpoint, never the full snapshot.
  assert.equal(source.includes('/api/snapshot'), false);
  // The destination only ever comes from the native dialog callback.
  assert.equal(source.includes('input.path'), false);
  assert.match(source, /new ReportDestination\(\s*selected,/);
});
