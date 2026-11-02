import {
  analyticsExportLimits,
  modelAnalyticsExportSourceSchema,
  modelAnalyticsQuerySchema,
  modelAnalyticsSummarySchema,
  type ModelAnalyticsQuery,
  type ModelAnalyticsSummary,
} from '@orqst/protocol';

export type AnalyticsRanking = 'tokens' | 'sessions';
export type AnalyticsExportFormat = 'csv' | 'markdown';

/** Sort a copy with the same comparator used by the screen; never reattribute usage. */
export function rankModelAnalytics(report: ModelAnalyticsSummary, ranking: AnalyticsRanking) {
  return [...report.models].sort((a, b) => {
    const left = ranking === 'tokens' ? a.usage?.total : a.sessions;
    const right = ranking === 'tokens' ? b.usage?.total : b.sessions;
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    return (
      right - left ||
      (a.model ?? '').localeCompare(b.model ?? '') ||
      a.adapter.localeCompare(b.adapter)
    );
  });
}

function queryKey(query: ModelAnalyticsQuery): string {
  return JSON.stringify(
    Object.fromEntries(
      (['from', 'to', 'workspaceId', 'agentId', 'adapter', 'model'] as const)
        .filter((key) => query[key] !== undefined)
        .map((key) => [key, query[key]]),
    ),
  );
}

/** Reversible visible ASCII: literal backslash is encoded too, so escapes cannot collide. */
function visibleText(value: string): string {
  return Array.from(value, (character) =>
    /^[a-zA-Z0-9 ._-]$/.test(character)
      ? character
      : `\\u{${character.codePointAt(0)!.toString(16)}}`,
  ).join('');
}

type Cell = string | number | boolean | null;
const columns = [
  'section',
  'field',
  'value',
  'adapter',
  'model_state',
  'model',
  'provider',
  'sessions',
  'input',
  'output',
  'cached',
  'total',
];

/** Fixed aggregate allowlist; query identities and arbitrary object keys never become output. */
export function serializeModelAnalytics(
  input: unknown,
  options: {
    format: AnalyticsExportFormat;
    ranking: AnalyticsRanking;
    obtainedAt: string;
    query: ModelAnalyticsQuery;
  },
): { text: string; filename: string; mime: string } {
  const report = modelAnalyticsExportSourceSchema.parse(input);
  const query = modelAnalyticsQuerySchema.parse(options.query);
  if (
    queryKey(query) !== queryKey(report.query) ||
    !['tokens', 'sessions'].includes(options.ranking) ||
    !['csv', 'markdown'].includes(options.format) ||
    !Number.isFinite(Date.parse(options.obtainedAt))
  )
    throw new Error('Analytics export mismatch');
  const records: Cell[][] = [];
  const metadata = (section: string, field: string, value: Cell) =>
    records.push([section, field, value, '', '', '', '', '', '', '', '', '']);
  metadata('report', 'contract', 'orqst.model-usage-export.v1');
  metadata('report', 'obtained_at_utc', new Date(options.obtainedAt).toISOString());
  metadata('report', 'ranking', options.ranking);
  metadata(
    'report',
    'csv_integer_encoding',
    'Up to 15 decimal digits are numeric; larger integers use literal int:digits to preserve precision.',
  );
  metadata('report', 'null', 'null means unavailable or unidentified; blank means not applicable');
  metadata('report', 'model_encoding', 'ASCII literals and backslash u{lowercase code point hex}');
  metadata(
    'report',
    'privacy',
    'Observed model IDs may contain private metadata or secrets. Review before sharing.',
  );
  metadata('report', 'cache', 'Cached input is a subset of input; never add it again.');
  metadata('report', 'sessions', 'Observed session counts are non-additive across model rows.');
  metadata('period', 'from_utc_inclusive', query.from ? new Date(query.from).toISOString() : null);
  metadata('period', 'to_utc_exclusive', query.to ? new Date(query.to).toISOString() : null);
  metadata('period', 'bounds', 'null bounds are unbounded; UTC half-open interval');
  for (const key of ['workspaceId', 'agentId', 'adapter', 'model'] as const)
    metadata(
      'filters',
      key === 'workspaceId' ? 'workspace' : key === 'agentId' ? 'agent' : key,
      query[key] === undefined
        ? 'all'
        : key === 'model' && query.model === null
          ? 'unidentified_only'
          : 'applied_value_omitted',
    );
  for (const [key, value] of Object.entries(report.basis)) metadata('basis', key, value);
  metadata('coverage', 'scope', report.coverage.scope);
  metadata('coverage', 'complete', report.coverage.complete);
  metadata('coverage', 'reason', report.coverage.reason);
  metadata('coverage', 'sessions', report.coverage.sessions);
  metadata('coverage', 'sessionsWithCanonicalUsage', report.coverage.sessionsWithCanonicalUsage);
  metadata('coverage', 'unidentifiedContributions', report.coverage.unidentifiedContributions);
  metadata('coverage', 'gap_categories', report.coverage.gaps.length);
  for (const gap of report.coverage.gaps) metadata('gap', gap.reason, gap.count);
  for (const [key, value] of Object.entries(report.unavailable))
    metadata('unavailable', key, value);
  const usageCells = (usage: ModelAnalyticsSummary['usage']): Cell[] =>
    usage ? [usage.input, usage.output, usage.cached, usage.total] : [null, null, null, null];
  records.push(['totals', '', '', '', '', '', null, report.sessions, ...usageCells(report.usage)]);
  for (const row of rankModelAnalytics(report, options.ranking))
    records.push([
      'model',
      '',
      '',
      row.adapter,
      row.model === null ? 'unidentified' : 'observed',
      row.model,
      row.provider,
      row.sessions,
      ...usageCells(row.usage),
    ]);
  const csvCell = (value: Cell) => {
    // Quote every field and prefix EVERY text cell before any whitespace or formula prefix.
    const literal =
      typeof value === 'number'
        ? value > 999999999999999
          ? `'int:${value}`
          : String(value)
        : `'${visibleText(String(value))}`;
    return `"${literal.replaceAll('"', '""')}"`;
  };
  const markdownCell = (value: Cell) =>
    typeof value === 'number' ? String(value) : `\`${visibleText(String(value))}\``;
  const csv = options.format === 'csv';
  const lines = [
    csv ? columns.map(csvCell).join(',') : `| ${columns.map(markdownCell).join(' | ')} |`,
    ...(csv ? [] : [`| ${columns.map(() => '---').join(' | ')} |`]),
  ];
  let bytes = 0;
  const eol = csv ? '\r\n' : '\n';
  const append = (line: string) => {
    bytes += new TextEncoder().encode(line + eol).byteLength;
    if (bytes > analyticsExportLimits.outputBytes) throw new Error('Analytics output limit');
  };
  lines.forEach(append);
  for (const row of records) {
    const line = csv ? row.map(csvCell).join(',') : `| ${row.map(markdownCell).join(' | ')} |`;
    append(line);
    lines.push(line);
  }
  return {
    text: lines.join(eol) + eol,
    filename: `orqst-model-usage.${csv ? 'csv' : 'md'}`,
    mime: `${csv ? 'text/csv' : 'text/markdown'};charset=utf-8`,
  };
}

/** Schema property order makes this canonical across browser and main; arrays retain order. */
export function canonicalModelAnalytics(input: unknown): string {
  return JSON.stringify(modelAnalyticsExportSourceSchema.parse(input));
}

/** Bound actual body bytes before decoding, joining or parsing; Content-Length is not authority. */
export async function readAnalyticsJSON(
  response: Response,
  limit = analyticsExportLimits.responseBytes,
  authorized: () => boolean = () => true,
): Promise<unknown> {
  if (
    !response.body ||
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    await response.body?.cancel();
    throw new Error('Invalid Analytics response');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (!authorized()) throw new Error('Revoked operation');
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Analytics response limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

export async function readModelAnalyticsResponse(
  response: Response,
): Promise<ModelAnalyticsSummary> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Analytics unavailable');
  }
  return modelAnalyticsSummarySchema.parse(await readAnalyticsJSON(response));
}
