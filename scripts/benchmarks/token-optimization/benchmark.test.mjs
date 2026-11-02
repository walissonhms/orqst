import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenarios } from './fixtures.mjs';
import { prepare, modes } from './optimizer.mjs';
import { createQualityValidator, parseAnswer } from './quality.mjs';
const facts = [
  ['tenant-isolation', 'parameter-binding'],
  ['tenant-isolation', 'input-immutable'],
  ['cumulative-not-additive', 'invalid-values-ignored'],
  ['tenant-isolation', 'untrusted-content'],
  ['no-cloud-required', 'observer-only'],
  ['legal-hold-exception', 'no-native-deletion'],
  ['validate-before-aggregate', 'prototype-safe'],
];
const artifacts = [
  "Invoice::query()->where('tenant_id', $tenantId)->where('status', 'open')->orderBy('id')->get();",
  `type Task = { id: string; tenantId: string; done: boolean }; export function visibleTasks(tasks: readonly Task[], tenantId: string): Task[] { return tasks.filter(t => t.tenantId === tenantId && t.done === false); }`,
  `type Usage = { session: string; cumulative: number; mirror?: boolean }; export function totalUsage(records: readonly Usage[]): number { const totals = new Map<string, number>(); for (const r of records) if (Number.isSafeInteger(r.cumulative) && r.cumulative >= 0) totals.set(r.session, Math.max(totals.get(r.session) ?? 0, r.cumulative)); return [...totals.values()].reduce((a,b) => a+b,0); }`,
  JSON.stringify({
    findings: [
      {
        id: 'missing-tenant-filter',
        file: 'InvoiceController.php',
        reason: 'Tenant filter is absent from the query.',
        remediation: 'Bind tenant_id to the authenticated tenant.',
      },
      {
        id: 'unsafe-html',
        file: 'Result.tsx',
        reason: 'Untrusted HTML is directly rendered.',
        remediation: 'Render the captured result as plain text.',
      },
    ],
  }),
  'MiniBridge requires Node >=24 <25 and pnpm 10.34.9. Run pnpm install --frozen-lockfile, then pnpm build, then pnpm start. Open http://127.0.0.1:4317. Loopback-only, read-only observer. No Cloud account is required. Browser notifications require permission.',
  JSON.stringify({
    defaultDays: 30,
    legalHoldDays: 365,
    purgeNativeHistory: false,
    failClosedOnUnknownTenant: true,
  }),
  `export function summarize(lines: readonly string[]): Record<string,number> { const out = Object.create(null); for (const line of lines) { try { const r = JSON.parse(line); if (r && !Array.isArray(r) && typeof r.tenant === 'string' && Number.isSafeInteger(r.amountCents) && r.amountCents >= 0) out[r.tenant] = (out[r.tenant] ?? 0) + r.amountCents; } catch {} } return out; }`,
];
test('disabled preserves all context; preparation never mutates fixtures', () => {
  const before = JSON.stringify(scenarios);
  for (const s of scenarios) {
    assert.equal(prepare(s, 'disabled').blocks.length, s.blocks.length);
    for (const mode of modes) prepare(s, mode);
  }
  assert.equal(JSON.stringify(scenarios), before);
});
test('deduplication preserves protected, different-provenance and repeated-log records', () => {
  const s = structuredClone(scenarios[0]);
  s.blocks = [
    s.blocks[0],
    { ...s.blocks[0] },
    { ...s.blocks[0], version: 'v2' },
    { ...s.blocks[0], scope: 'another-scope' },
    { ...s.blocks[0], role: 'tool' },
    { ...s.blocks[0], protected: true },
    { ...s.blocks[0], kind: 'log' },
    { ...s.blocks[0], kind: 'log' },
  ];
  const out = prepare(s, 'economy');
  assert.equal(out.blocks.length, 7);
  assert.equal(out.blocks.filter((b) => b.kind === 'log').length, 2);
  assert.equal(out.blocks.filter((b) => b.protected).length, 1);
});
test('all modes preserve important instructions and long-context exception byte for byte', () => {
  for (const s of scenarios)
    for (const mode of modes) {
      const baseline = prepare(s, 'disabled');
      const current = prepare(s, mode);
      assert.equal(current.protectedHash, baseline.protectedHash);
      assert.ok(current.prompt.includes(s.policy));
      assert.ok(current.prompt.includes(s.task));
      assert.ok(current.prompt.includes(s.context));
    }
});
test('Intelligent selects only trusted optional unrelated snapshots; risky or unknown tasks fall back', () => {
  const s = scenarios[1];
  assert.equal(prepare(s, 'intelligent').blocks.length, 1);
  for (const risk of [true, undefined])
    assert.equal(
      prepare({ ...s, risk }, 'intelligent').promptHash,
      prepare(s, 'economy').promptHash,
    );
  const untrusted = { ...s, blocks: s.blocks.map((b) => ({ ...b, trustedSelection: false })) };
  assert.equal(
    prepare(untrusted, 'intelligent').promptHash,
    prepare(untrusted, 'economy').promptHash,
  );
  assert.throws(() => prepare(s, 'aggressive'));
});
test('quality gates accept independent reference artifacts and reject broken outputs in all seven scenarios', async () => {
  const validator = await createQualityValidator();
  try {
    for (let i = 0; i < scenarios.length; i++) {
      const good = { artifact: artifacts[i], facts: facts[i] };
      const result = await validator.validate(scenarios[i], good);
      assert.equal(
        result.passed,
        true,
        JSON.stringify({ scenario: scenarios[i].id, checks: result.checks }),
      );
      const bad = await validator.validate(scenarios[i], { artifact: '{}', facts: facts[i] });
      assert.equal(bad.passed, false, scenarios[i].id);
      const missing = await validator.validate(scenarios[i], { ...good, facts: [] });
      assert.equal(missing.passed, false, scenarios[i].id);
    }
  } finally {
    await validator.close();
  }
});
test('lossy compression canary rejects a dropped long-context exception', async () => {
  const s = scenarios.find((s) => s.id === 'long-context');
  const validator = await createQualityValidator();
  try {
    const result = await validator.validate(s, {
      artifact: JSON.stringify({
        defaultDays: 30,
        legalHoldDays: 30,
        purgeNativeHistory: false,
        failClosedOnUnknownTenant: true,
      }),
      facts: facts[5],
    });
    assert.equal(result.passed, false);
    assert.ok(result.checks.some((c) => c.name === 'retention-and-rare-exception' && !c.passed));
  } finally {
    await validator.close();
  }
});
test('answer boundary rejects extra fields, missing facts and oversized generated code', () => {
  assert.throws(() => parseAnswer('{}'));
  assert.throws(() => parseAnswer(JSON.stringify({ artifact: '', facts: [], extra: true })));
  assert.throws(() => parseAnswer(JSON.stringify({ artifact: 'x'.repeat(12001), facts: [] })));
});

test('aggregate reports retain failed measurements and reject savings claims on failed quality or token growth', async () => {
  const { summarize } = await import('./summarize.mjs');
  const row = (mode, total, passed) => ({
    scenario: 'synthetic',
    repetition: 1,
    mode,
    quality: { passed },
    usage: { quality: 'observed', total, input: total - 1, output: 1, cached: 0 },
    elapsedMs: 1,
    optimizerMs: 0,
    promptBytes: 1,
  });
  const failed = summarize({
    kind: 'test',
    rows: [row('disabled', 100, true), row('economy', 50, false), row('intelligent', 120, true)],
  });
  assert.equal(failed.aggregates.find((r) => r.mode === 'economy').total, 50);
  assert.equal(failed.results[0].completeFixtureBenefit, false);
  assert.equal(failed.results[0].excludedPairs, 1);
  assert.equal(failed.results[1].qualityQualifiedTotalReductionPct, -20);
  assert.equal(failed.results[1].regressions, 1);
  assert.equal(failed.results[1].completeFixtureBenefit, false);
});

test('PHP expression scoring accepts optional statement terminators and described fact labels without weakening predicates', async () => {
  const validator = await createQualityValidator();
  try {
    const candidate = {
      artifact: artifacts[0].replace(/;$/, ''),
      facts: facts[0].map((f) => f + ': explanation'),
    };
    assert.equal((await validator.validate(scenarios[0], candidate)).passed, true);
    const wrong = {
      ...candidate,
      artifact: candidate.artifact.replace("->where('tenant_id', $tenantId)", ''),
    };
    assert.equal((await validator.validate(scenarios[0], wrong)).passed, false);
  } finally {
    await validator.close();
  }
});

test('offline usage remains unavailable and incomplete coverage never qualifies a complete fixture benefit', async () => {
  const { summarize } = await import('./summarize.mjs');
  const offline = summarize({
    kind: 'offline',
    rows: [
      {
        scenario: 'a',
        repetition: 1,
        mode: 'disabled',
        quality: { passed: null },
        usage: null,
        optimizerMs: 0,
        promptBytes: 10,
      },
    ],
  });
  assert.equal(offline.aggregates[0].input, null);
  assert.equal(offline.aggregates[0].total, null);
  assert.equal(offline.aggregates[0].elapsedMs, null);
  assert.equal(offline.results[0].completeFixtureBenefit, false);
  const make = (mode, total) => ({
    scenario: 'a',
    repetition: 1,
    mode,
    quality: { passed: true },
    usage: { quality: 'observed', input: total, output: 0, total, cached: 0 },
    optimizerMs: 0,
    promptBytes: 1,
  });
  const partial = summarize({
    kind: 'live',
    methodology: { selected: ['a', 'b'], repetitions: 1 },
    rows: [make('disabled', 10), make('economy', 5)],
  });
  assert.equal(partial.results[0].completeFixtureBenefit, false);
});
