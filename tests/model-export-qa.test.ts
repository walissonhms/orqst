// Independent Model Usage export QA. Synthetic aggregates only; no installed DB or captures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsExportLimits,
  modelAnalyticsExportSourceSchema,
  type ModelAnalyticsSummary,
  type Usage,
} from '@orqst/protocol';
import {
  rankModelAnalytics,
  readModelAnalyticsResponse,
  serializeModelAnalytics,
} from '../apps/dashboard/src/analytics-export.js';

const usage: Usage = { input: 100, output: 20, cached: 40, total: 120 };

function summary(overrides: Partial<ModelAnalyticsSummary> = {}): ModelAnalyticsSummary {
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
      gaps: [
        { reason: 'usage_not_reported', count: 1 },
        { reason: 'window_boundary', count: 2 },
      ],
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

const options = (overrides: Partial<Parameters<typeof serializeModelAnalytics>[1]> = {}) => ({
  format: 'csv' as const,
  ranking: 'tokens' as const,
  obtainedAt: '2026-11-02T12:00:00.000Z',
  query: {},
  ...overrides,
});

/** Minimal RFC 4180 reader: fields never contain raw CR/LF because they are escaped. */
function parseCsv(text: string): string[][] {
  return text
    .split('\r\n')
    .slice(0, -1)
    .map((line) => {
      const cells: string[] = [];
      let value = '';
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index]!;
        if (quoted) {
          if (character === '"' && line[index + 1] === '"') {
            value += '"';
            index += 1;
          } else if (character === '"') quoted = false;
          else value += character;
        } else if (character === '"') quoted = true;
        else if (character === ',') {
          cells.push(value);
          value = '';
        } else value += character;
      }
      cells.push(value);
      return cells;
    });
}

function csvRows(report: ModelAnalyticsSummary, override = options()): string[][] {
  return parseCsv(serializeModelAnalytics(report, override).text);
}

/** Reverse the shared visible-ASCII encoding; single pass so escapes never re-decode. */
const decode = (text: string) =>
  text.replace(/\\u\{([0-9a-f]+)\}/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));

const cellText = (cell: string) => decode(cell.startsWith("'") ? cell.slice(1) : cell);

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const columns = [
  "'section",
  "'field",
  "'value",
  "'adapter",
  "'model_state",
  "'model",
  "'provider",
  "'sessions",
  "'input",
  "'output",
  "'cached",
  "'total",
];

test('CSV is one rectangular 12-column table with CRLF, no BOM and fixed names', () => {
  const file = serializeModelAnalytics(summary(), options());
  assert.equal(file.filename, 'orqst-model-usage.csv');
  assert.equal(file.mime, 'text/csv;charset=utf-8');
  // Every field is quoted, so the file opens with the quote before the apostrophe.
  assert.equal(file.text.startsWith('"\'section"'), true);
  assert.equal(file.text.startsWith('\uFEFF'), false);
  assert.ok(file.text.endsWith('\r\n'));
  assert.equal(file.text.replaceAll('\r\n', '').includes('\n'), false);
  assert.equal(file.text.replaceAll('\r\n', '').includes('\r'), false);
  const rows = parseCsv(file.text);
  for (const row of rows) assert.equal(row.length, 12, JSON.stringify(row));
  assert.deepEqual(rows[0], columns);
  // Every text cell carries the literal apostrophe before the value, numbers do not.
  for (const row of rows) {
    for (const [index, cell] of row.entries()) {
      // Numbers stay numeric (quoted, no apostrophe); the int marker is the only exception.
      const numeric = /^\d+$/.test(cell) || /^'int:\d+$/.test(cell);
      if (!numeric) assert.equal(cell.startsWith("'"), true, `${index}:${cell}`);
    }
  }
  // Metadata first, then totals, then models; no blank lines anywhere.
  const sections = rows.map((row) => row[0]);
  assert.equal(sections.includes("'"), false);
  assert.equal(sections.at(-3), "'totals");
  assert.equal(sections.at(-2), "'model");
  assert.equal(sections.at(-1), "'model");
});

test('bytes are deterministic for the same input and options', () => {
  const first = serializeModelAnalytics(summary(), options());
  const second = serializeModelAnalytics(summary(), options());
  assert.equal(first.text, second.text);
  assert.equal(first.filename, second.filename);
});

test('unidentified bucket stays distinct from a literal model named unknown', () => {
  const report = summary({
    models: [
      {
        adapter: 'codex',
        provider: null,
        model: null,
        sessions: 1,
        usage: { input: 60, output: 10, cached: 20, total: 70 },
      },
      {
        adapter: 'codex',
        provider: null,
        model: 'unknown',
        sessions: 1,
        usage: { input: 40, output: 10, cached: 20, total: 50 },
      },
    ],
  });
  const rows = csvRows(report).filter((row) => row[0] === "'model");
  assert.equal(rows.length, 2);
  const nullRow = rows.find((row) => row[4] === "'unidentified")!;
  const literalRow = rows.find((row) => row[4] === "'observed")!;
  assert.equal(nullRow[5], "'null");
  assert.equal(literalRow[5], "'unknown");
  assert.notEqual(nullRow[5], literalRow[5]);
  // Markdown keeps the same distinction inside code spans.
  const markdown = serializeModelAnalytics(report, options({ format: 'markdown' })).text;
  assert.match(markdown, /`unidentified` \| `null`/);
  assert.match(markdown, /`observed` \| `unknown`/);
});

test('absent usage is a literal null marker while a confirmed zero stays numeric', () => {
  const missing = summary({
    usage: null,
    sessions: 1,
    models: [
      { adapter: 'codex', provider: null, model: 'synthetic-alpha', sessions: 1, usage: null },
    ],
    coverage: {
      scope: 'before_model_filter',
      complete: false,
      reason: 'source_coverage_unverified',
      sessions: 1,
      sessionsWithCanonicalUsage: 0,
      unidentifiedContributions: 0,
      gaps: [{ reason: 'usage_not_reported', count: 1 }],
    },
  });
  const rows = csvRows(missing);
  const totals = rows.find((row) => row[0] === "'totals")!;
  assert.deepEqual(totals.slice(8), ["'null", "'null", "'null", "'null"]);
  const model = rows.find((row) => row[0] === "'model")!;
  assert.deepEqual(model.slice(8), ["'null", "'null", "'null", "'null"]);
  assert.equal(totals[7], '1');

  const zero = summary({
    usage: { input: 0, output: 0, cached: 0, total: 0 },
    sessions: 1,
    models: [
      {
        adapter: 'codex',
        provider: null,
        model: 'synthetic-zero',
        sessions: 1,
        usage: { input: 0, output: 0, cached: 0, total: 0 },
      },
    ],
  });
  const zeroRows = csvRows(zero);
  assert.deepEqual(zeroRows.find((row) => row[0] === "'totals")!.slice(8), ['0', '0', '0', '0']);
  assert.deepEqual(zeroRows.find((row) => row[0] === "'model")!.slice(8), ['0', '0', '0', '0']);
});

test('private filter values and identities never reach the exported bytes', () => {
  const secretQuery = {
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-02T00:00:00.000Z',
    workspaceId: 'workspace-secret-111',
    agentId: 'agent-secret-222',
    adapter: 'claude' as const,
    model: 'filter-secret-333',
  };
  const report = summary({ query: secretQuery });
  for (const format of ['csv', 'markdown'] as const) {
    const file = serializeModelAnalytics(report, options({ format, query: secretQuery }));
    for (const secret of [
      'workspace-secret-111',
      'agent-secret-222',
      'filter-secret-333',
      'claude',
    ])
      assert.equal(file.text.includes(secret), false, `${format}:${secret}`);
    // Instants keep their value; ':' is visible-ASCII encoded.
    assert.equal(file.text.includes('2026-11-01T00\\u{3a}00\\u{3a}00.000Z'), true);
    assert.equal(file.text.includes('applied_value_omitted'), true);
    assert.equal(file.text.includes('unidentified_only'), false);
  }

  const unidentified = { model: null };
  const unidentifiedFile = serializeModelAnalytics(
    summary({ query: unidentified }),
    options({ query: unidentified }),
  );
  assert.equal(unidentifiedFile.text.includes('unidentified_only'), true);
  // Unbounded periods stay explicit instead of inventing bounds.
  assert.equal(unidentifiedFile.text.includes("'null"), true);
  assert.equal(unidentifiedFile.text.includes('null bounds are unbounded'), true);
});

test('hostile model text is encoded into one inert cell per format', () => {
  const hostile =
    '=cmd|\' /C calc\'!A0 "quoted",comma\r\nline<script>[x](javascript:alert) `tick` \\ end';
  const report = summary({
    usage: null,
    models: [
      {
        adapter: 'codex',
        provider: null,
        model: hostile,
        sessions: 1,
        usage: null,
      },
    ],
    sessions: 1,
    coverage: {
      scope: 'before_model_filter',
      complete: false,
      reason: 'source_coverage_unverified',
      sessions: 1,
      sessionsWithCanonicalUsage: 0,
      unidentifiedContributions: 0,
      gaps: [{ reason: 'usage_not_reported', count: 1 }],
    },
  });
  const rows = csvRows(report);
  const modelRow = rows.find((row) => row[0] === "'model")!;
  assert.equal(modelRow.length, 12);
  // Formula prefix cannot survive: the apostrophe precedes the encoded value.
  assert.equal(modelRow[5]!.startsWith("'"), true);
  assert.equal(modelRow[5]!.includes('\r'), false);
  assert.equal(modelRow[5]!.includes('\n'), false);
  assert.equal(modelRow[5]!.includes('"'), false);
  assert.equal(modelRow[5]!.includes('\\u{3d}cmd'), true);
  assert.equal(modelRow[5]!.includes('\\u{22}quoted\\u{22}'), true);
  assert.equal(modelRow[5]!.includes('\\u{d}\\u{a}'), true);
  assert.equal(modelRow[5]!.includes('\\u{3c}script\\u{3e}'), true);
  assert.equal(modelRow[5]!.includes('\\u{60}tick\\u{60}'), true);
  assert.equal(modelRow[5]!.includes('\\u{5c}'), true);
  assert.equal(modelRow[5]!.includes('\u0000'), false);
  // The raw CSV file has no CR/LF inside the record.
  const file = serializeModelAnalytics(report, options());
  assert.equal(file.text.replaceAll('\r\n', '').includes('\r'), false);
  assert.equal(file.text.replaceAll('\r\n', '').includes('\n'), false);

  const markdown = serializeModelAnalytics(report, options({ format: 'markdown' })).text;
  assert.equal(markdown.includes('\r'), false);
  assert.equal(markdown.includes('<script>'), false);
  assert.equal(markdown.includes('](javascript:'), false);
  assert.equal(markdown.includes('http://'), false);
  const markdownModel = markdown.split('\n').find((line) => line.startsWith('| `model`'))!;
  assert.equal(markdownModel.split(' | ').length, 12);
  assert.equal(markdownModel.includes('`tick`'), false);
});

test('markdown is a fixed pipe table with code spans and no extra columns', () => {
  const file = serializeModelAnalytics(summary(), options({ format: 'markdown' }));
  assert.equal(file.filename, 'orqst-model-usage.md');
  assert.equal(file.mime, 'text/markdown;charset=utf-8');
  assert.equal(file.text.startsWith('\uFEFF'), false);
  assert.ok(file.text.endsWith('\n'));
  assert.equal(file.text.includes('\r'), false);
  const lines = file.text.split('\n').slice(0, -1);
  assert.equal(lines[1], `| ${columns.map(() => '---').join(' | ')} |`);
  for (const line of lines) {
    assert.equal(line.startsWith('| '), true);
    assert.equal(line.endsWith(' |'), true);
    assert.equal(line.split(' | ').length, 12, line);
  }
  assert.equal(file.text.includes('<'), false);
  assert.equal(file.text.includes(']('), false);
  assert.equal(file.text.includes('!['), false);
});

test('model names up to 256 code units pass and longer names fail without output', () => {
  const long = 'a'.repeat(analyticsExportLimits.modelChars);
  const accepted = summary({
    usage: null,
    sessions: 1,
    models: [{ adapter: 'codex', provider: null, model: long, sessions: 1, usage: null }],
    coverage: {
      scope: 'before_model_filter',
      complete: false,
      reason: 'source_coverage_unverified',
      sessions: 1,
      sessionsWithCanonicalUsage: 0,
      unidentifiedContributions: 0,
      gaps: [{ reason: 'usage_not_reported', count: 1 }],
    },
  });
  const file = serializeModelAnalytics(accepted, options());
  assert.equal(file.text.includes(long), true);
  assert.throws(
    () =>
      serializeModelAnalytics(
        { ...accepted, models: [{ ...accepted.models[0]!, model: `${long}b` }] },
        options(),
      ),
    /too_big|String must contain at most/i,
  );
});

test('admission rejects extra fields, inconsistent totals, duplicates and invalid queries', () => {
  const report = summary();
  const rejects: unknown[] = [
    { ...report, extra: 1 },
    { ...report, contractVersion: 2 },
    { ...report, usage: { ...usage, total: 999 } },
    { ...report, usage: null },
    {
      ...report,
      models: [report.models[0]!, { ...report.models[0]! }],
    },
    { ...report, models: [{ ...report.models[0]!, cost: 0 }] },
    { ...report, coverage: { ...report.coverage, complete: true } },
    {
      ...report,
      coverage: {
        ...report.coverage,
        gaps: [
          { reason: 'window_boundary', count: 1 },
          { reason: 'window_boundary', count: 2 },
        ],
      },
    },
    { ...report, unavailable: { ...report.unavailable, cost: 'zero' } },
    { ...report, sessions: 99 },
    { ...report, models: [{ ...report.models[0]!, sessions: 99 }] },
    { ...report, query: { workspaceId: 'x' } },
  ];
  for (const invalid of rejects)
    assert.throws(
      () => serializeModelAnalytics(invalid, options()),
      Error,
      JSON.stringify(invalid).slice(0, 80),
    );
  assert.equal(modelAnalyticsExportSourceSchema.safeParse(report).success, true);

  assert.throws(
    () => serializeModelAnalytics(report, options({ query: { adapter: 'codex' } })),
    /mismatch/,
  );
  assert.throws(
    () => serializeModelAnalytics(report, options({ obtainedAt: 'not-a-date' })),
    /mismatch/,
  );
  assert.throws(
    () => serializeModelAnalytics(report, { ...options(), format: 'json' as never }),
    /mismatch/,
  );
  assert.throws(
    () => serializeModelAnalytics(report, { ...options(), ranking: 'cost' as never }),
    /mismatch/,
  );
});

test('5000 maximal buckets stay complete and 5001 fail admission without output', () => {
  const base = summary();
  const max = Number.MAX_SAFE_INTEGER;
  // Largest admitted row: 256-char model, 16-digit sessions, largest safe per-row usage.
  const perRow = Math.floor(max / 5000);
  const rowUsage: Usage = { input: perRow, output: 0, cached: 0, total: perRow };
  const bucket = (model: string): ModelAnalyticsSummary['models'][number] => ({
    adapter: 'codex',
    provider: null,
    model,
    sessions: max,
    usage: rowUsage,
  });
  const models = Array.from({ length: 5000 }, (_, index) =>
    bucket(`${'a'.repeat(250)}${String(index).padStart(6, '0')}`),
  );
  const many = {
    ...base,
    usage: { input: perRow * 5000, output: 0, cached: 0, total: perRow * 5000 },
    sessions: max,
    models,
    coverage: {
      ...base.coverage,
      sessions: max,
      sessionsWithCanonicalUsage: max,
      unidentifiedContributions: 0,
      gaps: [],
    },
  };
  assert.equal(modelAnalyticsExportSourceSchema.safeParse(many).success, true);
  const file = serializeModelAnalytics(many, options());
  const rows = parseCsv(file.text);
  assert.equal(rows.filter((row) => row[0] === "'model").length, 5000);
  // Every row keeps its 12 cells and its exact model name: nothing is truncated.
  assert.equal(rows.at(-1)!.length, 12);
  assert.equal(file.text.includes('a'.repeat(250)), true);
  assert.ok(
    new TextEncoder().encode(file.text).byteLength <= analyticsExportLimits.outputBytes,
    'admitted input must fit the output budget',
  );
  assert.throws(
    () => serializeModelAnalytics({ ...many, models: [...models, bucket('overflow')] }, options()),
    Error,
  );
});

test('ranking matches the screen comparator and never reattributes usage', () => {
  const report = summary({
    models: [
      {
        adapter: 'codex',
        provider: null,
        model: 'b',
        sessions: 3,
        usage: { input: 10, output: 5, cached: 0, total: 15 },
      },
      {
        adapter: 'codex',
        provider: null,
        model: 'a',
        sessions: 3,
        usage: { input: 10, output: 5, cached: 0, total: 15 },
      },
      { adapter: 'codex', provider: null, model: null, sessions: 1, usage: null },
      {
        adapter: 'claude',
        provider: null,
        model: 'a',
        sessions: 3,
        usage: { input: 10, output: 5, cached: 0, total: 15 },
      },
    ],
    usage: { input: 30, output: 15, cached: 0, total: 45 },
    sessions: 4,
    coverage: {
      scope: 'before_model_filter',
      complete: false,
      reason: 'source_coverage_unverified',
      sessions: 4,
      sessionsWithCanonicalUsage: 3,
      unidentifiedContributions: 1,
      gaps: [],
    },
  });
  const byTokens = rankModelAnalytics(report, 'tokens').map((row) => `${row.adapter}:${row.model}`);
  assert.deepEqual(byTokens, ['claude:a', 'codex:a', 'codex:b', 'codex:null']);
  const bySessions = rankModelAnalytics(report, 'sessions').map(
    (row) => `${row.adapter}:${row.model}`,
  );
  assert.deepEqual(bySessions, ['claude:a', 'codex:a', 'codex:b', 'codex:null']);
  assert.deepEqual(
    report.models.map((row) => row.model),
    ['b', 'a', null, 'a'],
  );
  // Export keeps the same order as the ranking it declares.
  const rows = csvRows(report, options({ ranking: 'tokens' })).filter((row) => row[0] === "'model");
  assert.deepEqual(
    rows.map((row) => row[5]),
    ["'a", "'a", "'b", "'null"],
  );
  assert.equal(rows[0]![3], "'claude");
});

test('CSV preserves 16-digit safe integers with an unambiguous int marker', () => {
  const fifteen = 999999999999999;
  const sixteen = 1000000000000000;
  const max = Number.MAX_SAFE_INTEGER;
  const big: Usage = {
    input: sixteen,
    output: fifteen,
    cached: 0,
    total: sixteen + fifteen,
  };
  const report = summary({
    usage: big,
    sessions: max,
    models: [
      { adapter: 'codex', provider: null, model: 'synthetic-big', sessions: max, usage: big },
    ],
    coverage: {
      scope: 'before_model_filter',
      complete: false,
      reason: 'source_coverage_unverified',
      sessions: max,
      sessionsWithCanonicalUsage: max,
      unidentifiedContributions: 0,
      gaps: [],
    },
  });
  const rows = csvRows(report);
  const totals = rows.find((row) => row[0] === "'totals")!;
  // 15 digits stay numeric (quoted, no apostrophe); 16 digits and above are marked.
  assert.equal(totals[7], `'int:${max}`);
  assert.equal(totals[8], `'int:${sixteen}`);
  assert.equal(totals[9], String(fifteen));
  assert.equal(totals[10], '0');
  assert.equal(totals[11], `'int:${sixteen + fifteen}`);
  const model = rows.find((row) => row[0] === "'model")!;
  assert.deepEqual(model.slice(8), [
    `'int:${sixteen}`,
    String(fifteen),
    '0',
    `'int:${sixteen + fifteen}`,
  ]);
  // Round-trip: stripping the marker returns the exact digits, never a rounded value.
  const digits = (cell: string) => (cell.startsWith("'int:") ? cell.slice(5) : cell);
  assert.equal(digits(totals[11]!), String(big.total));
  assert.equal(digits(totals[7]!), String(max));
  assert.equal(BigInt(digits(totals[11]!)) === BigInt(big.total), true);
  // The marker cannot collide with ordinary text, where ':' is encoded.
  assert.equal(totals[0], "'totals");
  const encoding = rows.find((row) => row[0] === "'report" && row[1] === "'csv_integer_encoding");
  assert.ok(encoding, 'csv_integer_encoding metadata is required');
  assert.equal(encoding![2]!.includes('int\\u{3a}digits'), true);
  // Markdown keeps full decimal integers without the CSV marker.
  const markdown = serializeModelAnalytics(report, options({ format: 'markdown' })).text;
  assert.equal(markdown.includes('int:'), false);
  assert.equal(markdown.includes(String(max)), true);
  assert.equal(markdown.includes(String(sixteen)), true);
});

test('screen acceptance stays structural while export admission keeps its caps', async () => {
  const base = summary();
  const unmeasured = {
    usage: null,
    sessions: 0,
    coverage: {
      ...base.coverage,
      sessions: 0,
      sessionsWithCanonicalUsage: 0,
      unidentifiedContributions: 0,
      gaps: [],
    },
  };
  const longReport = {
    ...base,
    ...unmeasured,
    models: [
      {
        adapter: 'codex' as const,
        provider: null,
        model: 'a'.repeat(257),
        sessions: 0,
        usage: null,
      },
    ],
  };
  const manyModels = {
    ...base,
    ...unmeasured,
    models: Array.from({ length: 5001 }, (_, index) => ({
      adapter: 'codex' as const,
      provider: null,
      model: `m${index}`,
      sessions: 0,
      usage: null,
    })),
  };
  // The screen keeps showing legitimate reports that only exceed export admission.
  assert.equal(
    (await readModelAnalyticsResponse(jsonResponse(longReport))).models[0]!.model!.length,
    257,
  );
  assert.equal((await readModelAnalyticsResponse(jsonResponse(manyModels))).models.length, 5001);
  // Export admission still fails closed and produces no file.
  assert.throws(() => serializeModelAnalytics(longReport, options()), Error);
  assert.throws(() => serializeModelAnalytics(manyModels, options()), Error);
  assert.equal(modelAnalyticsExportSourceSchema.safeParse(longReport).success, false);
  assert.equal(modelAnalyticsExportSourceSchema.safeParse(manyModels).success, false);
});

test('coverage, gaps, basis and unavailable stay explicit after decoding', () => {
  const rows = csvRows(summary());
  const find = (section: string, field: string) =>
    rows.find((row) => row[0] === `'${section}` && row[1] === `'${field}`)!;
  assert.equal(cellText(find('coverage', 'complete')[2]!), 'false');
  assert.equal(cellText(find('coverage', 'reason')[2]!), 'source_coverage_unverified');
  assert.equal(find('coverage', 'gap_categories')[2], '2');
  assert.equal(find('gap', 'usage_not_reported')[2], '1');
  assert.equal(find('gap', 'window_boundary')[2], '2');
  assert.equal(cellText(find('basis', 'period')[2]!), 'fully_contained_intervals_half_open');
  assert.equal(
    cellText(find('basis', 'sessions')[2]!),
    'observed_sessions_non_additive_across_models',
  );
  assert.equal(
    cellText(find('unavailable', 'cost')[2]!),
    'verified_prices_and_billing_not_recorded',
  );
  assert.equal(
    cellText(find('report', 'sessions')[2]!),
    'Observed session counts are non-additive across model rows.',
  );
  assert.equal(
    cellText(find('report', 'cache')[2]!),
    'Cached input is a subset of input; never add it again.',
  );
  assert.equal(cellText(find('report', 'privacy')[2]!).includes('may contain private'), true);
  // Decoding is a no-op on a plain cell and never invents characters.
  assert.equal(cellText("'synthetic-alpha"), 'synthetic-alpha');
});

test('formula prefixes behind whitespace, tab, CR, LF and NBSP stay inert', () => {
  const prefixes = ['', ' ', '\t', '\r', '\n', '\u00a0', ' \t ', '\u00a0 '];
  const triggers = ['=', '+', '-', '@'];
  for (const [index, prefix] of prefixes.entries()) {
    for (const [position, trigger] of triggers.entries()) {
      const model = `${prefix}${trigger}cmd|' /C calc'!A0`;
      const report = summary({
        usage: null,
        sessions: 0,
        models: [{ adapter: 'codex', provider: null, model, sessions: 0, usage: null }],
        coverage: {
          scope: 'before_model_filter',
          complete: false,
          reason: 'source_coverage_unverified',
          sessions: 0,
          sessionsWithCanonicalUsage: 0,
          unidentifiedContributions: 0,
          gaps: [],
        },
      });
      const file = serializeModelAnalytics(report, options());
      const cell = parseCsv(file.text).find((row) => row[0] === "'model")![5]!;
      // The apostrophe always precedes the value, before any whitespace or formula char.
      assert.equal(cell.startsWith("'"), true, `${index}:${position}`);
      const body = cell.slice(1);
      // '=', '+', '@' are always encoded; a leading '-' is guarded by the apostrophe.
      assert.equal(body.startsWith('=') || body.startsWith('+') || body.startsWith('@'), false);
      if (body.startsWith('-')) assert.equal(cell.startsWith("'-"), true);
      for (const control of ['\t', '\r', '\n', '\u00a0'])
        assert.equal(cell.includes(control), false, `${index}:${position}:${control}`);
      assert.equal(file.text.replaceAll('\r\n', '').includes('\n'), false);
      assert.equal(file.text.replaceAll('\r\n', '').includes('\r'), false);
      assert.equal(parseCsv(file.text).filter((row) => row[0] === "'model").length, 1);
      // The literal text is recoverable, so safety does not destroy the value.
      assert.equal(cellText(cell), model);
    }
  }
});

test('encoding is reversible for escapes, emoji and bidi and cannot be confused', () => {
  const values = ['\\u{a}', '\n', '😀 emoji', '\u202e bidi override', 'a\tb', 'plain value', '\\'];
  for (const value of values) {
    const report = summary({
      usage: null,
      sessions: 0,
      models: [{ adapter: 'codex', provider: null, model: value, sessions: 0, usage: null }],
      coverage: {
        scope: 'before_model_filter',
        complete: false,
        reason: 'source_coverage_unverified',
        sessions: 0,
        sessionsWithCanonicalUsage: 0,
        unidentifiedContributions: 0,
        gaps: [],
      },
    });
    const cell = parseCsv(serializeModelAnalytics(report, options()).text).find(
      (row) => row[0] === "'model",
    )![5]!;
    assert.equal(cellText(cell), value, value);
  }
  // A literal backslash-u sequence is distinguishable from the newline it resembles.
  const literal = (model: string) => {
    const report = summary({
      usage: null,
      sessions: 0,
      models: [{ adapter: 'codex', provider: null, model, sessions: 0, usage: null }],
      coverage: {
        scope: 'before_model_filter',
        complete: false,
        reason: 'source_coverage_unverified',
        sessions: 0,
        sessionsWithCanonicalUsage: 0,
        unidentifiedContributions: 0,
        gaps: [],
      },
    });
    return parseCsv(serializeModelAnalytics(report, options()).text).find(
      (row) => row[0] === "'model",
    )![5]!;
  };
  assert.notEqual(literal('\\u{a}'), literal('\n'));
  assert.equal(literal('\n').includes('\\u{a}'), true);
  assert.equal(literal('\\u{a}').includes('\\u{5c}'), true);
});

test('unicode expansion can exceed the output budget while the input stays under it', () => {
  const base = summary();
  const models = Array.from({ length: 2500 }, (_, index) => ({
    adapter: 'codex' as const,
    provider: null,
    model: `${'あ'.repeat(252)}${String(index).padStart(4, '0')}`,
    sessions: 0,
    usage: null,
  }));
  const report = {
    ...base,
    usage: null,
    sessions: 0,
    models,
    coverage: {
      ...base.coverage,
      sessions: 0,
      sessionsWithCanonicalUsage: 0,
      unidentifiedContributions: 0,
      gaps: [],
    },
  };
  const inputBytes = new TextEncoder().encode(JSON.stringify(report)).byteLength;
  assert.ok(inputBytes < analyticsExportLimits.responseBytes, `input ${inputBytes}`);
  assert.equal(modelAnalyticsExportSourceSchema.safeParse(report).success, true);
  assert.throws(() => serializeModelAnalytics(report, options()), /output limit/);
});

test('streaming admission rejects oversized, non-JSON, invalid and non-ok responses', async () => {
  const json = { 'content-type': 'application/json; charset=utf-8' };
  assert.deepEqual(
    await readModelAnalyticsResponse(new Response(JSON.stringify(summary()), { headers: json })),
    summary(),
  );
  await assert.rejects(
    readModelAnalyticsResponse(new Response('{}', { status: 500, headers: json })),
    /unavailable/,
  );
  await assert.rejects(
    readModelAnalyticsResponse(
      new Response(JSON.stringify(summary()), { headers: { 'content-type': 'text/plain' } }),
    ),
    /Invalid Analytics response/,
  );
  await assert.rejects(
    readModelAnalyticsResponse(new Response('not json', { headers: json })),
    /Unexpected token|JSON/i,
  );
  await assert.rejects(
    readModelAnalyticsResponse(new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { headers: json })),
    /decode|UTF-8|encoded/i,
  );
  await assert.rejects(
    readModelAnalyticsResponse(
      new Response(JSON.stringify({ ...summary(), extra: true }), { headers: json }),
    ),
  );
  // A false small Content-Length is not authority; accumulated bytes decide.
  await assert.rejects(
    readModelAnalyticsResponse(
      new Response('y'.repeat(analyticsExportLimits.responseBytes + 1), {
        headers: { 'content-type': 'application/json', 'content-length': '10' },
      }),
    ),
    /response limit/,
  );
  // One byte above the streaming budget fails before any parse.
  const oversized = 'x'.repeat(analyticsExportLimits.responseBytes + 1);
  await assert.rejects(
    readModelAnalyticsResponse(new Response(oversized, { headers: json })),
    /response limit/,
  );
  // Chunked bodies are still bounded by accumulated bytes.
  const chunk = new TextEncoder().encode(oversized);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < chunk.length; offset += 65536)
        controller.enqueue(chunk.slice(offset, offset + 65536));
      controller.close();
    },
  });
  await assert.rejects(
    readModelAnalyticsResponse(new Response(stream, { headers: json })),
    /response limit/,
  );
  // Multibyte UTF-8 split across chunk boundaries still parses exactly.
  const multibyte = summary();
  const multibyteModels = [
    { adapter: 'codex' as const, provider: null, model: 'あ😀', sessions: 1, usage: null },
  ];
  const multibyteReport = {
    ...multibyte,
    usage: null,
    sessions: 1,
    models: multibyteModels,
    coverage: {
      ...multibyte.coverage,
      sessions: 1,
      sessionsWithCanonicalUsage: 0,
      unidentifiedContributions: 0,
      gaps: [],
    },
  };
  const multibyteBytes = new TextEncoder().encode(JSON.stringify(multibyteReport));
  const splitStream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < multibyteBytes.length; offset += 7)
        controller.enqueue(multibyteBytes.slice(offset, offset + 7));
      controller.close();
    },
  });
  assert.deepEqual(
    await readModelAnalyticsResponse(new Response(splitStream, { headers: json })),
    multibyteReport,
  );
  // Fewer characters than the cap but more bytes: still rejected.
  const wide = new TextEncoder().encode(
    JSON.stringify({
      ...multibyteReport,
      models: [{ ...multibyteModels[0]!, model: 'あ'.repeat(256) }],
    }),
  );
  assert.ok(wide.byteLength < analyticsExportLimits.responseBytes);
  const wideStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(analyticsExportLimits.responseBytes)));
      controller.enqueue(new TextEncoder().encode('あ'));
      controller.close();
    },
  });
  await assert.rejects(
    readModelAnalyticsResponse(new Response(wideStream, { headers: json })),
    /response limit/,
  );

  const valid = new TextEncoder().encode(JSON.stringify(summary()));
  const validStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(valid.slice(0, 10));
      controller.enqueue(valid.slice(10));
      controller.close();
    },
  });
  assert.deepEqual(
    await readModelAnalyticsResponse(new Response(validStream, { headers: json })),
    summary(),
  );
});
