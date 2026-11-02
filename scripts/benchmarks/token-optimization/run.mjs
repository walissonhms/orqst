import { parseArgs } from 'node:util';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir, platform, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { scenarios } from './fixtures.mjs';
import { prepare, modes, digest } from './optimizer.mjs';
import { createQualityValidator, parseAnswer } from './quality.mjs';
process.umask(0o077);
const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    model: { type: 'string' },
    repetitions: { type: 'string', default: '1' },
    output: { type: 'string' },
    scenario: { type: 'string' },
    'timeout-ms': { type: 'string', default: '60000' },
    'max-reported-tokens': { type: 'string', default: '1500000' },
  },
});
const repetitions = Number(values.repetitions);
const timeoutMs = Number(values['timeout-ms']);
const tokenLimit = Number(values['max-reported-tokens']);
if (
  !Number.isInteger(repetitions) ||
  repetitions < 1 ||
  repetitions > 5 ||
  !Number.isInteger(timeoutMs) ||
  timeoutMs < 1000 ||
  timeoutMs > 120000 ||
  !Number.isSafeInteger(tokenLimit) ||
  tokenLimit <= 0
)
  throw new Error('Invalid bounded benchmark options');
if (values.live && (!values.model || !values.output))
  throw new Error(
    'Live mode requires explicit --model and --output; it consumes real provider usage',
  );
const selected = values.scenario ? scenarios.filter((s) => s.id === values.scenario) : scenarios;
if (!selected.length) throw new Error('Unknown scenario');
const schema = {
  type: 'object',
  properties: { artifact: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } } },
  required: ['artifact', 'facts'],
  additionalProperties: false,
};
const version = (cmd, args) => {
  const p = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10000 });
  return p.status === 0 ? p.stdout.split('\n')[0].trim() : 'unavailable';
};
function validUsage(value) {
  if (
    !value ||
    !['input_tokens', 'output_tokens'].every((k) => Number.isSafeInteger(value[k]) && value[k] >= 0)
  )
    return null;
  const cached = value.cached_input_tokens;
  if (
    cached !== undefined &&
    (!Number.isSafeInteger(cached) || cached < 0 || cached > value.input_tokens)
  )
    return null;
  return {
    input: value.input_tokens,
    output: value.output_tokens,
    total: value.input_tokens + value.output_tokens,
    cached: cached ?? null,
    cacheWrite: value.cache_write_input_tokens ?? null,
    reasoningOutput: value.reasoning_output_tokens ?? null,
    quality: 'observed',
    source: 'codex-exec-turn.completed',
    cachedIsSubsetOfInput: true,
  };
}
async function callProvider(prompt, dir, schemaPath) {
  const started = performance.now();
  const args = [
    'exec',
    '--ignore-user-config',
    '--ephemeral',
    '--skip-git-repo-check',
    '--disable',
    'hooks',
    '--disable',
    'plugins',
    '--sandbox',
    'read-only',
    '--model',
    values.model,
    '-c',
    'model_reasoning_effort="low"',
    '--json',
    '--output-schema',
    schemaPath,
    '-C',
    dir,
    '-',
  ];
  let stdout = '',
    stderr = '',
    timedOut = false,
    overflow = false;
  const child = spawn('codex', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  child.stdout.on('data', (chunk) => {
    if (stdout.length + chunk.length > 2 * 1024 * 1024) {
      overflow = true;
      child.kill('SIGTERM');
    } else stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-16000);
  });
  let hardKill;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    hardKill = setTimeout(() => child.kill('SIGKILL'), 2000);
  }, timeoutMs);
  let code;
  try {
    code = await new Promise((resolveCode, reject) => {
      child.once('error', reject);
      child.once('close', resolveCode);
    });
  } finally {
    clearTimeout(timer);
    if (hardKill) clearTimeout(hardKill);
  }
  const events = stdout.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const turns = events.filter((e) => e.type === 'turn.completed');
  const usage = turns.length === 1 ? validUsage(turns[0].usage) : null;
  const toolCalls = events.filter(
    (e) =>
      e.type === 'item.completed' &&
      ['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].includes(e.item?.type),
  ).length;
  const answer = events
    .filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message')
    .at(-1)?.item.text;
  return {
    elapsedMs: Math.round(performance.now() - started),
    usage,
    toolCalls,
    answer,
    success: code === 0 && !timedOut && !overflow && turns.length === 1 && toolCalls === 0,
    failure: timedOut
      ? 'timeout'
      : overflow
        ? 'output-limit'
        : code !== 0
          ? 'provider-exit'
          : turns.length !== 1
            ? 'missing-or-multiple-usage-turns'
            : toolCalls
              ? 'unexpected-tools'
              : null,
    stderrPresent: stderr.length > 0,
  };
}
const report = {
  schemaVersion: 1,
  kind: values.live ? 'synthetic-tasks-real-codex-usage' : 'offline-context-size-only',
  generatedAt: new Date().toISOString(),
  environment: {
    platform: platform(),
    arch: arch(),
    node: process.version,
    codex: values.live ? version('codex', ['--version']) : null,
    php: version('php', ['--version']),
    modelRequested: values.model ?? null,
    reasoningEffort: 'low',
    userConfigIgnored: true,
    ephemeral: true,
    sandbox: 'read-only',
    modelSnapshot: 'not-exposed-by-exec-stream',
    billingMode: 'not-inferred',
    optimizerVersion: 'independent-experiment-v1',
    qualityValidatorVersion: 2,
    fixtureVersion: 'synthetic-v1',
    fixtureDigest: digest(JSON.stringify(scenarios)),
  },
  methodology: {
    repetitions,
    selected: selected.map((s) => s.id),
    order: 'sequential-rotating-modes-by-scenario-and-repetition',
    harnessRetries: 0,
    providerRetries: null,
    costUsd: null,
    costReason:
      'No validated model/billing rate mapping supplied; CLI subscription is not API billing.',
    maximumReportedTokens: tokenLimit,
    timeoutMs,
    byteCountsAreTokens: false,
    intelligentPrototype:
      'trusted-fixture-metadata-selection-with-high-risk-fallback-not-learned-adaptation',
    executionScope: 'standalone-benchmark-outside-ORQST-runtime-and-CI',
  },
  rows: [],
};
const dir = values.live ? await mkdtemp(join(tmpdir(), 'orqst-token-benchmark-')) : null;
const validator = values.live ? await createQualityValidator() : null;
let observedTotal = 0,
  stopped = false;
try {
  const schemaPath = dir ? join(dir, 'answer-schema.json') : null;
  if (schemaPath) await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
  for (let repetition = 0; repetition < (values.live ? repetitions : 1); repetition++) {
    for (let index = 0; index < selected.length; index++) {
      const scenario = selected[index];
      const offset = (index + repetition) % modes.length;
      const order = [...modes.slice(offset), ...modes.slice(0, offset)];
      for (const mode of order) {
        if (observedTotal >= tokenLimit) {
          stopped = true;
          break;
        }
        const started = performance.now();
        const prepared = prepare(scenario, mode);
        const row = {
          scenario: scenario.id,
          mode,
          repetition: repetition + 1,
          promptBytes: Buffer.byteLength(prepared.prompt),
          promptHash: prepared.promptHash,
          protectedHash: prepared.protectedHash,
          optimizerMs: Number((performance.now() - started).toFixed(3)),
          removed: prepared.removed,
          fallback: prepared.fallback,
          usage: null,
          quality: { passed: null, reason: 'offline-no-provider-execution' },
          elapsedMs: null,
          harnessRetries: 0,
          providerRetries: null,
          costUsd: null,
        };
        if (values.live) {
          const call = await callProvider(prepared.prompt, dir, schemaPath);
          row.usage = call.usage;
          row.elapsedMs = call.elapsedMs;
          row.toolCalls = call.toolCalls;
          row.failure = call.failure;
          row.stderrPresent = call.stderrPresent;
          observedTotal += call.usage?.total ?? 0;
          try {
            const answer = parseAnswer(call.answer);
            row.answerHash = digest(call.answer);
            row.quality = await validator.validate(scenario, answer);
            if (!call.success) row.quality.passed = false;
          } catch {
            row.quality = { passed: false, reason: 'missing-or-invalid-answer' };
          }
          console.log(
            JSON.stringify({
              scenario: row.scenario,
              mode,
              repetition: row.repetition,
              total: row.usage?.total ?? null,
              passed: row.quality.passed,
              failure: row.failure,
            }),
          );
        }
        report.rows.push(row);
        if (values.output) {
          await mkdir(resolve(values.output, '..'), { recursive: true });
          await writeFile(values.output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
        }
      }
      if (stopped) break;
    }
    if (stopped) break;
  }
} finally {
  await validator?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
}
report.stoppedByTokenLimit = stopped;
report.observedTotalIncludingFailedRows = observedTotal;
report.rawResponsesPersisted = false;
if (values.output)
  await writeFile(values.output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
else console.log(JSON.stringify(report, null, 2));
