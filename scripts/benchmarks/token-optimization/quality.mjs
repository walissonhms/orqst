import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { transform } from 'esbuild';
import { chromium } from '@playwright/test';
const requiredFacts = {
  'php-laravel': ['tenant-isolation', 'parameter-binding'],
  'react-typescript': ['tenant-isolation', 'input-immutable'],
  'bug-fixing': ['cumulative-not-additive', 'invalid-values-ignored'],
  'code-review': ['tenant-isolation', 'untrusted-content'],
  documentation: ['no-cloud-required', 'observer-only'],
  'long-context': ['legal-hold-exception', 'no-native-deletion'],
  'multi-step': ['validate-before-aggregate', 'prototype-safe'],
};
export function parseAnswer(text) {
  const value = JSON.parse(text);
  if (
    !value ||
    typeof value.artifact !== 'string' ||
    value.artifact.length > 12000 ||
    !Array.isArray(value.facts) ||
    !value.facts.every((v) => typeof v === 'string') ||
    Object.keys(value).sort().join() !== 'artifact,facts'
  )
    throw new Error('Invalid bounded answer');
  return value;
}
export async function createQualityValidator() {
  let browser;
  return {
    async validate(scenario, answer) {
      const checks = [];
      const check = (name, ok) => checks.push({ name, passed: Boolean(ok) });
      check(
        'important-instructions',
        requiredFacts[scenario.id].every((fact) =>
          answer.facts.some((reported) => reported === fact || reported.startsWith(fact + ':')),
        ),
      );
      const artifact = answer.artifact.trim();
      try {
        if (scenario.kind === 'php-query') {
          const compact = artifact.replace(/\s+/g, '').replaceAll('"', "'").replace(/;$/, '');
          const expected =
            "Invoice::query()->where('tenant_id',$tenantId)->where('status','open')->orderBy('id')->get()";
          // Exact restricted query grammar, not eval of generated PHP.
          check('bound-tenant-query-grammar', compact === expected);
          const rows = [
            { id: 3, tenant_id: 7, status: 'open' },
            { id: 2, tenant_id: 8, status: 'open' },
            { id: 1, tenant_id: 7, status: 'open' },
            { id: 4, tenant_id: 7, status: 'closed' },
          ];
          check(
            'query-reference-cases',
            compact === expected &&
              JSON.stringify(
                rows
                  .filter((r) => r.tenant_id === 7 && r.status === 'open')
                  .sort((a, b) => a.id - b.id)
                  .map((r) => r.id),
              ) === '[1,3]',
          );
          const dir = await mkdtemp(join(tmpdir(), 'orqst-benchmark-php-'));
          try {
            const file = join(dir, 'candidate.php');
            await writeFile(
              file,
              '<?php\nfunction benchmark($tenantId) { return ' +
                artifact.replace(/;$/, '') +
                ';\n}\n',
              { mode: 0o600 },
            );
            const lint = spawnSync('php', ['-n', '-l', file], { encoding: 'utf8', timeout: 3000 });
            check('php-syntax', lint.status === 0);
          } finally {
            await rm(dir, { recursive: true, force: true });
          }
        } else if (scenario.kind === 'typescript') {
          // Only transpilation occurs in Node. Candidate execution is in a fresh
          // browser context without host bindings, permissions, or network access.
          const result = await transform(artifact, {
            loader: 'ts',
            format: 'iife',
            globalName: 'Candidate',
            target: 'es2023',
          });
          check('typescript-syntax', true);
          browser ??= await chromium.launch({ headless: true });
          const context = await browser.newContext({ permissions: [] });
          await context.route('**/*', (route) => route.abort());
          const page = await context.newPage();
          await page.setContent(
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'\">",
          );
          const timeout = setTimeout(() => {
            void context.close().catch(() => {});
          }, 2000);
          try {
            const passed = await page.evaluate(
              ({ code, id, exportName }) => {
                const candidate = new Function(code + '; return Candidate;')();
                const f = candidate[exportName];
                if (typeof f !== 'function') return false;
                if (id === 'react-typescript') {
                  const rows = Object.freeze(
                    [
                      { id: 'one', tenantId: 'a', done: false },
                      { id: 'two', tenantId: 'b', done: false },
                      { id: 'three', tenantId: 'a', done: true },
                      { id: 'four', tenantId: 'a', done: false },
                    ].map(Object.freeze),
                  );
                  const result = f(rows, 'a');
                  return (
                    Array.isArray(result) &&
                    result !== rows &&
                    result.length === 2 &&
                    result[0] === rows[0] &&
                    result[1] === rows[3] &&
                    f(rows, 'b')[0] === rows[1] &&
                    f([], 'a').length === 0 &&
                    f(rows, 'missing').length === 0
                  );
                }
                if (id === 'bug-fixing') {
                  const rows = Object.freeze(
                    [
                      { session: 'a', cumulative: 10 },
                      { session: 'a', cumulative: 15 },
                      { session: 'a', cumulative: 15, mirror: true },
                      { session: 'b', cumulative: 7 },
                      { session: 'a', cumulative: 5 },
                      { session: 'bad', cumulative: -1 },
                      { session: 'bad', cumulative: NaN },
                      { session: 'bad', cumulative: Infinity },
                      { session: 'bad', cumulative: 1.5 },
                    ].map(Object.freeze),
                  );
                  return (
                    f(rows) === 22 &&
                    f([]) === 0 &&
                    f([
                      { session: '', cumulative: 3 },
                      { session: '', cumulative: 3 },
                    ]) === 3 &&
                    f([...rows].reverse()) === 22
                  );
                }
                const lines = Object.freeze([
                  'bad-json',
                  'null',
                  '[]',
                  '{}',
                  '{"tenant":"a","amountCents":10}',
                  '{"tenant":"a","amountCents":5}',
                  '{"tenant":"b","amountCents":2}',
                  '{"tenant":"a","amountCents":-1}',
                  '{"tenant":"a","amountCents":"9"}',
                  '{"tenant":"a","amountCents":1.5}',
                  '{"tenant":"__proto__","amountCents":7}',
                  '{"tenant":"constructor","amountCents":3}',
                  '{"tenant":"","amountCents":4}',
                  '{"tenant":2,"amountCents":99}',
                ]);
                const out = f(lines);
                return (
                  Object.getPrototypeOf(out) === null &&
                  Object.keys(out).length === 5 &&
                  out.a === 15 &&
                  out.b === 2 &&
                  out.__proto__ === 7 &&
                  out.constructor === 3 &&
                  out[''] === 4 &&
                  Object.keys(f([])).length === 0
                );
              },
              { code: result.code, id: scenario.id, exportName: scenario.exportName },
            );
            check('functional-and-negative-cases', passed);
          } finally {
            clearTimeout(timeout);
            await context.close();
          }
        } else if (scenario.kind === 'review') {
          const result = JSON.parse(artifact);
          const findings = result.findings;
          check(
            'known-findings-only',
            Array.isArray(findings) &&
              findings.length === 2 &&
              findings
                .map((f) => f.id)
                .sort()
                .join() === 'missing-tenant-filter,unsafe-html',
          );
          check(
            'actionable-findings',
            Array.isArray(findings) &&
              findings.every(
                (f) =>
                  typeof f.reason === 'string' &&
                  f.reason.length > 10 &&
                  typeof f.remediation === 'string' &&
                  f.remediation.length > 10 &&
                  (f.id === 'missing-tenant-filter'
                    ? f.file === 'InvoiceController.php' && /tenant/i.test(f.reason + f.remediation)
                    : f.file === 'Result.tsx' &&
                      /text|HTML|render/i.test(f.reason + f.remediation)),
              ),
          );
        } else if (scenario.kind === 'documentation') {
          check(
            'exact-commands-and-runtime',
            [
              'pnpm install --frozen-lockfile',
              'pnpm build',
              'pnpm start',
              '>=24 <25',
              '10.34.9',
              'http://127.0.0.1:4317',
            ].every((s) => artifact.includes(s)),
          );
          check(
            'documented-boundaries',
            /loopback/i.test(artifact) &&
              /read.only|observer.only/i.test(artifact) &&
              /no cloud|without.*cloud|cloud.*not required/i.test(artifact) &&
              /notification[\s\S]*permission/i.test(artifact),
          );
          check(
            'no-invented-features',
            !/supports? (?:Electron|orchestration)|costs? (?:are|is) calculated|0\.0\.0\.0/i.test(
              artifact,
            ),
          );
        } else {
          const result = JSON.parse(artifact);
          check(
            'retention-and-rare-exception',
            result.defaultDays === 30 && result.legalHoldDays === 365,
          );
          check(
            'security-and-native-history',
            result.purgeNativeHistory === false &&
              result.failClosedOnUnknownTenant === true &&
              Object.keys(result).length === 4,
          );
        }
      } catch {
        check('validator-or-candidate-error', false);
      }
      return {
        validatorVersion: 2,
        passed: checks.every((c) => c.passed),
        checks,
        scope:
          scenario.kind === 'php-query'
            ? 'restricted-query-grammar-and-php-lint-not-laravel-integration'
            : scenario.kind === 'typescript'
              ? 'transpilation-and-browser-functional-cases-not-full-framework'
              : 'bounded-content-assertions-not-complete-semantic-equivalence',
      };
    },
    async close() {
      await browser?.close();
    },
  };
}
