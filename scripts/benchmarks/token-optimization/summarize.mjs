import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const reduction = (baseline, optimized) =>
  baseline > 0 ? Number(((100 * (baseline - optimized)) / baseline).toFixed(3)) : null;
export function summarize(report) {
  const comparisons = [];
  for (const baseline of report.rows.filter((r) => r.mode === 'disabled')) {
    for (const mode of ['economy', 'intelligent']) {
      const optimized = report.rows.find(
        (r) =>
          r.scenario === baseline.scenario &&
          r.repetition === baseline.repetition &&
          r.mode === mode,
      );
      const valid =
        baseline.quality.passed === true &&
        optimized?.quality.passed === true &&
        (baseline.quality.validatorVersion ?? 1) === (optimized?.quality.validatorVersion ?? 1) &&
        baseline.protectedHash === optimized?.protectedHash &&
        baseline.usage?.quality === 'observed' &&
        optimized?.usage?.quality === 'observed';
      comparisons.push({
        scenario: baseline.scenario,
        repetition: baseline.repetition,
        mode,
        valid,
        baselineTotal: baseline.usage?.total ?? null,
        optimizedTotal: optimized?.usage?.total ?? null,
        totalReductionPct: valid ? reduction(baseline.usage.total, optimized.usage.total) : null,
        exclusion: valid ? null : 'missing-measurement-or-quality-failure',
      });
    }
  }
  const aggregates = ['disabled', 'economy', 'intelligent'].map((mode) => {
    const rows = report.rows.filter((r) => r.mode === mode);
    const measured = rows.filter((r) => r.usage?.quality === 'observed');
    return {
      mode,
      trials: rows.length,
      qualityPassed: rows.filter((r) => r.quality.passed === true).length,
      measured: measured.length,
      input: measured.length ? measured.reduce((n, r) => n + r.usage.input, 0) : null,
      output: measured.length ? measured.reduce((n, r) => n + r.usage.output, 0) : null,
      total: measured.length ? measured.reduce((n, r) => n + r.usage.total, 0) : null,
      cached:
        measured.length && measured.every((r) => r.usage.cached !== null)
          ? measured.reduce((n, r) => n + r.usage.cached, 0)
          : null,
      elapsedMs: rows.some((r) => typeof r.elapsedMs === 'number')
        ? rows.reduce((n, r) => n + (r.elapsedMs ?? 0), 0)
        : null,
      optimizerMs: rows.reduce((n, r) => n + r.optimizerMs, 0),
      promptBytes: rows.reduce((n, r) => n + r.promptBytes, 0),
    };
  });
  const results = ['economy', 'intelligent'].map((mode) => {
    const pairs = comparisons.filter((r) => r.mode === mode);
    const expectedPairs =
      report.methodology?.selected.length * report.methodology?.repetitions || pairs.length;
    const eligible = pairs.filter((r) => r.valid);
    const base = eligible.reduce((n, r) => n + r.baselineTotal, 0);
    const optimized = eligible.reduce((n, r) => n + r.optimizedTotal, 0);
    return {
      mode,
      pairs: pairs.length,
      eligiblePairs: eligible.length,
      excludedPairs: pairs.length - eligible.length,
      regressions: eligible.filter((r) => r.optimizedTotal > r.baselineTotal).length,
      qualityQualifiedTotalReductionPct: eligible.length ? reduction(base, optimized) : null,
      completeFixtureBenefit:
        pairs.length > 0 &&
        pairs.length === expectedPairs &&
        !report.stoppedByTokenLimit &&
        pairs.every((r) => r.valid) &&
        optimized < base,
      productionBenefitVerified: false,
    };
  });
  return {
    kind: report.kind,
    aggregates,
    results,
    comparisons,
    limitations: [
      'Synthetic duplicated-context tasks; not representative production traces.',
      'Quality checks are bounded; no full Laravel/React application integration.',
      'Model snapshot, provider retries and monetary billing are not exposed/validated.',
      'No calibrated confidence interval; cache state and provider variability are uncontrolled.',
    ],
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Pass the benchmark JSON path');
  console.log(
    JSON.stringify(summarize(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2),
  );
}
