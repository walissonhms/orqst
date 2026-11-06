// SYNTHETIC golden fixture for lane L3 (admission, exit-pending, retirement, lifecycle receipts).
// Drives the TypeScript functions on disposable temp directories and prints JSON results.
// Usage: tsx admission.ts <scenario> <dir>. Never point <dir> at real Application Support data.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const crypto = require('node:crypto') as { randomUUID: () => string };
const uuids: string[] = [];
crypto.randomUUID = () => {
  const next = uuids.shift();
  if (!next) throw new Error('synthetic uuid sequence exhausted');
  return next;
};
syncBuiltinESMExports();
let clock = 1_700_000_000_000;
Date.now = () => clock;

const root = '../../../../../packages/core/src';
const admissionModule = await import(`${root}/managed-codex/desktop-admission.js`);
const inspection = await import(`${root}/managed-codex/desktop-admission-inspection.js`);
const exitPending = await import(`${root}/terminal/exit-pending.js`);
const receipts = await import(`${root}/managed-codex/lifecycle-receipt.js`);
const startup = await import(`${root}/terminal/startup-failure.js`);
const shutdown = await import(`${root}/terminal/owned-shutdown.js`);
const enrollment = await import(`${root}/terminal/enrollment-files.js`);
const authority = await import(`${root}/terminal/authority.js`);

export const ids = {
  owner: '11111111-1111-4111-8111-111111111111',
  epoch: '22222222-2222-4222-8222-222222222222',
  archive: '33333333-3333-4333-8333-333333333333',
  op: '44444444-4444-4444-8444-444444444444',
  a: '55555555-5555-4555-8555-555555555555',
  b: '66666666-6666-4666-8666-666666666666',
  owner2: '77777777-7777-4777-8777-777777777777',
  terminal: '88888888-8888-4888-8888-888888888888',
};
const manifests = ['/synthetic/a.json', '/synthetic/b.json'];

function classify(error: unknown): string {
  if (error instanceof inspection.DesktopAdmissionRefused) return `refused:${error.code}`;
  const e = error as { code?: unknown; name?: string; message?: string };
  if (typeof e.code === 'string' && /^E[A-Z]+$/.test(e.code)) return e.code;
  if (e.name === 'ZodError' || e.name === 'SyntaxError' || e.name === '$ZodError') return 'invalid';
  return e.message ?? String(error);
}
const results: unknown[] = [];
function step(name: string, run: () => unknown) {
  try {
    const value = run();
    results.push([name, 'ok', value ?? null]);
  } catch (error) {
    results.push([name, classify(error)]);
  }
}
async function stepAsync(name: string, run: () => Promise<unknown>) {
  try {
    const value = await run();
    results.push([name, 'ok', value ?? null]);
  } catch (error) {
    results.push([name, classify(error)]);
  }
}
function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort())
    if (!name.startsWith('.')) {
      try {
        out[name] = readFileSync(join(dir, name), 'utf8');
      } catch {
        out[name] = '<unreadable>';
      }
    }
  return out;
}
const shape = (value: unknown) =>
  typeof value === 'string'
    ? JSON.stringify((JSON.parse(value) as unknown[]).map((v) => (typeof v === 'string' && /^-?\d+$/.test(v) ? 'N' : v)))
    : value;

const [scenario, base] = [process.argv[2]!, process.argv[3]!];
const dir = join(base, 'managed-agents');
const evidence = {
  epoch: ids.epoch,
  attempts: [
    { slot: 0, instanceId: ids.a, epoch: ids.epoch, state: 'exited', exit: { exitCode: 0 } },
    { slot: 1, instanceId: ids.b, epoch: ids.epoch, state: 'prepared' },
  ],
};

if (scenario === 'marker') {
  uuids.push(ids.owner, ids.archive);
  let admission: ReturnType<typeof admissionModule.desktopAgentsAdmission> | undefined;
  step('open', () => {
    admission = admissionModule.desktopAgentsAdmission(dir, manifests, ids.epoch);
    return admission!.owner;
  });
  step('assertBeforeClaim', () => admission!.assertOwner());
  step('preflight', () => admission!.preflight());
  step('claim', () => admission!.claim());
  step('claimAgain', () => admission!.claim());
  step('preflightClaimed', () => admission!.preflight());
  step('secondOpen', () => admissionModule.desktopAgentsAdmission(dir, manifests, ids.epoch));
  step('inspectCurrent', () =>
    shape(
      inspection.inspectDesktopAdmission(dir, {
        owner: ids.owner,
        epoch: ids.epoch,
        initialFiles: manifests,
      }),
    ),
  );
  step('inspectOtherFiles', () =>
    inspection.inspectDesktopAdmission(dir, {
      owner: ids.owner,
      epoch: ids.epoch,
      initialFiles: ['/synthetic/other.json'],
    }),
  );
  let finish: ((receipt: unknown) => void) | undefined;
  const input = {
    version: 1,
    epoch: ids.epoch,
    opId: ids.op,
    expectedRevision: 0,
    workspaceId: 'c'.repeat(64),
    featureId: null,
  };
  const member = {
    terminalId: ids.terminal,
    alias: `P-${ids.terminal}`,
    provider: 'codex',
    requestedModel: 'synthetic-model',
    workspaceId: 'c'.repeat(64),
    featureId: null,
    bindingDigest: 'd'.repeat(64),
    slot: 2,
    admissionRevision: 1,
    status: 'uncertain',
  };
  step('reserveEnrollment', () => {
    finish = admission!.reserveEnrollment!({ input, manifestFile: '/synthetic/c.json', member });
  });
  step('finishEnrollment', () =>
    finish!({ ...input, revision: 1, status: 'ready', reason: 'admitted', member: { ...member, status: 'ready' } }),
  );
  step('reserveDuplicate', () =>
    admission!.reserveEnrollment!({ input, manifestFile: '/synthetic/c.json', member }),
  );
  let release: (() => void) | undefined;
  clock += 5;
  step('prepareRelease', () => {
    release = admission!.prepareRelease({ ...evidence, note: 'synthetic   "q" é', ratio: 1.5 });
  });
  step('finishRelease', () => release!());
  step('claimRetired', () => admission!.claim());
  step('preflightRetired', () => admission!.preflight());
  step('assertRetired', () => admission!.assertOwner());
  console.log(JSON.stringify({ results, files: files(dir) }));
} else if (scenario === 'refusals') {
  const absent = join(base, 'absent');
  step('inspectAbsent', () => shape(inspection.inspectDesktopAdmission(absent)));
  step('inspectAbsentTrailing', () => inspection.inspectDesktopAdmission(absent + '/'));
  step('inspectAbsentWithContext', () =>
    inspection.inspectDesktopAdmission(absent, { owner: ids.owner, epoch: ids.epoch, initialFiles: manifests }),
  );
  mkdirSync(dir, { mode: 0o700 });
  step('inspectEmpty', () => shape(inspection.inspectDesktopAdmission(dir)));
  step('badContext', () =>
    inspection.inspectDesktopAdmission(dir, { owner: 'x', epoch: ids.epoch, initialFiles: manifests }),
  );
  const marker = join(dir, 'active-pair.json');
  const cases: Array<[string, string, number?]> = [
    ['garbage', 'not json\n'],
    ['extraKey', JSON.stringify({ version: 1, owner: ids.owner, manifests, extra: 1 }) + '\n'],
    ['badVersion', JSON.stringify({ version: 2, owner: ids.owner, manifests }) + '\n'],
    ['relativeManifest', JSON.stringify({ version: 1, owner: ids.owner, manifests: ['a'] }) + '\n'],
    ['groupReadable', JSON.stringify({ version: 1, owner: ids.owner, manifests }) + '\n', 0o640],
    ['floatVersion', '{"version":1.0,"owner":"' + ids.owner + '","manifests":[]}'],
    ['duplicateKey', '{"version":1,"owner":"bad","owner":"' + ids.owner + '","manifests":[]}'],
    ['noEpoch', JSON.stringify({ version: 1, owner: ids.owner, manifests }) + '\n'],
  ];
  for (const [name, content, mode] of cases) {
    writeFileSync(marker, content, { mode: 0o600 });
    if (mode) chmodSync(marker, mode);
    step(name, () => inspection.inspectDesktopAdmission(dir));
    step(name + 'Open', () => admissionModule.desktopAgentsAdmission(dir, manifests, ids.epoch));
    require('node:fs').unlinkSync(marker);
  }
  symlinkSync('/synthetic/target', marker);
  step('symlinkMarker', () => inspection.inspectDesktopAdmission(dir));
  require('node:fs').unlinkSync(marker);
  writeFileSync(join(dir, 'offline-recovery.json'), '{}', { mode: 0o600 });
  step('offlineGate', () => inspection.inspectDesktopAdmission(dir));
  step('offlineGateOpen', () => admissionModule.desktopAgentsAdmission(dir, manifests));
  require('node:fs').unlinkSync(join(dir, 'offline-recovery.json'));
  uuids.push(ids.owner);
  const admission = admissionModule.desktopAgentsAdmission(dir, manifests);
  writeFileSync(join(dir, 'offline-recovery-operation.lock'), '', { mode: 0o600 });
  step('claimWithLock', () => admission.claim());
  step('preflightWithLock', () => admission.preflight());
  require('node:fs').unlinkSync(join(dir, 'offline-recovery-operation.lock'));
  writeFileSync(marker, 'foreign\n', { mode: 0o600 });
  step('preflightForeign', () => admission.preflight());
  step('claimForeign', () => admission.claim());
  step('preserveWithoutEpoch', () => admission.preservePendingExit());
  console.log(JSON.stringify({ results, files: files(dir) }));
} else if (scenario === 'exit-pending') {
  uuids.push(ids.owner, ids.owner2);
  const admission = admissionModule.desktopAgentsAdmission(dir, manifests, ids.epoch);
  step('claim', () => admission.claim());
  const record = {
    evidence: {
      attempts: [
        { exit: { signal: 15, exitCode: -1.0 }, state: 'exited', epoch: ids.epoch, instanceId: ids.a, slot: 0 },
        { slot: 1, instanceId: ids.b, epoch: ids.epoch, state: 'start_failed' },
      ],
      epoch: ids.epoch,
    },
    owner: ids.owner,
    status: 'leader_exited_retirement_pending',
    version: 1,
  };
  step('invalidRunning', () =>
    exitPending.preserveOwnedExitPending(
      dir,
      { ...record, evidence: { ...record.evidence, attempts: [{ slot: 0, instanceId: ids.a, epoch: ids.epoch, state: 'running' }] } },
      admission.assertOwner,
    ),
  );
  step('readMissing', () => exitPending.readOwnedExitPending(dir, ids.owner, ids.epoch));
  step('detachWithoutMarker', () => admission.preservePendingExit());
  step('preserve', () => exitPending.preserveOwnedExitPending(dir, record, admission.assertOwner));
  step('preserveSame', () => exitPending.preserveOwnedExitPending(dir, record, admission.assertOwner));
  step('preserveChanged', () =>
    exitPending.preserveOwnedExitPending(
      dir,
      { ...record, evidence: { ...record.evidence, attempts: [record.evidence.attempts[0]] } },
      admission.assertOwner,
    ),
  );
  step('readOtherEpoch', () => exitPending.readOwnedExitPending(dir, ids.owner, ids.owner2));
  step('readBadOwner', () => exitPending.readOwnedExitPending(dir, 'nope', ids.epoch));
  step('inspectBefore', () => inspection.inspectDesktopAdmission(dir));
  step('pendingBefore', () => exitPending.inspectPendingOwnedExits(dir));
  step('detach', () => admission.preservePendingExit());
  step('detachAgain', () => admission.preservePendingExit());
  step('pendingAfter', () => exitPending.inspectPendingOwnedExits(dir));
  step('pendingAbsentDir', () => exitPending.inspectPendingOwnedExits(join(base, 'absent')));
  step('reopen', () => admissionModule.desktopAgentsAdmission(dir, manifests, ids.epoch).owner);
  console.log(JSON.stringify({ results, files: files(dir) }));
} else if (scenario === 'lifecycle') {
  const state = join(base, 'state');
  mkdirSync(state, { mode: 0o700 });
  const binding = (instanceId: string) => ({
    configDigest: 'e'.repeat(64),
    epoch: ids.epoch,
    instanceId,
    manifestDigest: 'f'.repeat(64),
  });
  const read = (instanceId: string) => receipts.readLifecycleReceipt(state, binding(instanceId));
  let fd = 0;
  step('create', () => {
    fd = receipts.createLifecycleReceipt(state, binding(ids.a));
  });
  step('createAgain', () => receipts.createLifecycleReceipt(state, binding(ids.a)));
  step('wrongConfig', () => receipts.assertLifecycleConfig(fd, '0'.repeat(64)));
  step('readPrepared', () => read(ids.a));
  clock -= 10;
  let recorder: { record: (value: object) => Promise<void> } | undefined;
  step('arm', () => {
    recorder = receipts.armLifecycleReceipt(fd, 'e'.repeat(64));
  });
  step('armAgain', () => receipts.armLifecycleReceipt(fd, 'e'.repeat(64)));
  clock += 30;
  await stepAsync('exitBeforeStart', () => recorder!.record({ type: 'exit', code: 1, signal: null }));
  await stepAsync('started', () => recorder!.record({ type: 'started' }));
  await stepAsync('badExit', () => recorder!.record({ type: 'exit', code: null, signal: null }));
  clock += 1;
  await stepAsync('exit', () => recorder!.record({ type: 'exit', code: null, signal: 'SIGTERM' }));
  await stepAsync('afterExit', () => recorder!.record({ type: 'started' }));
  step('readExit', () => read(ids.a));
  let fd2 = 0;
  step('create2', () => {
    fd2 = receipts.createLifecycleReceipt(state, binding(ids.b));
  });
  const recorder2 = receipts.armLifecycleReceipt(fd2, 'e'.repeat(64));
  await stepAsync('spawnFailed', () => recorder2.record({ type: 'spawn_failed' }));
  step('readSpawnFailed', () => read(ids.b));
  step('readMissing', () => read(ids.owner2));
  step('readOtherBinding', () =>
    receipts.readLifecycleReceipt(state, { ...binding(ids.b), configDigest: '1'.repeat(64) }),
  );
  step('readBadBinding', () => receipts.readLifecycleReceipt(state, { ...binding(ids.b), epoch: 'x' }));
  writeFileSync(join(state, `lifecycle-${ids.owner}.jsonl`), '{"type":"prepared"}', { mode: 0o600 });
  step('readPartial', () => read(ids.owner));
  step('readMissingState', () =>
    receipts.readLifecycleReceipt(join(base, 'absent'), binding(ids.a)),
  );
  console.log(JSON.stringify({ results, files: files(state) }));
} else if (scenario === 'pure') {
  for (const [id, failure] of [
    ['startup-1', { stage: 'core_admission', code: 'capacity_reserved', effects: 'possible' }],
    ['startup-01', undefined],
    [ids.a, { stage: 'core_startup', code: 'startup_timeout', effects: 'possible' }],
    [ids.a, { stage: 'core_startup', code: 'failed', effects: 'possible' }],
    [ids.a, { stage: 'opening', code: 'startup_eof', effects: 'possible' }],
    [ids.a, { stage: 'core_admission', code: 'admission_invalid', effects: 'not_started' }],
    [ids.a, undefined],
  ] as const)
    step(`host:${id}:${failure?.code}`, () =>
      startup.terminalStartupHostFailure(id, failure ? new startup.TerminalStartupError(failure) : new Error('x')),
    );
  for (const code of ['capacity_reserved', 'owned_exit_pending', 'admission_invalid', 'startup_failed'])
    step(`core:${code}`, () =>
      startup.terminalStartupFailureSchema.parse({
        type: 'startup-failure',
        id: 'startup-42',
        failure: { stage: 'core_admission', code, effects: 'possible' },
      }),
    );
  const config = {
    version: 2,
    state: '/synthetic/state',
    z: { b: 1, a: [1.5, 1e21, 1e-7, -0, 123456789012, 0.1] },
    text: 'é   \u0001 "quoted" \\ / <tag>',
    model: { value: 'm', files: [{ path: '/synthetic/model.json' }] },
  };
  step('preimage', () => {
    const preimage = enrollment.terminalEnrollmentPreimage(
      config,
      ['1:2', null],
      Buffer.from('synthetic source ÿ'),
      [['/synthetic/model.json', null]],
    );
    return { preimage, digest: authority.terminalDigest(preimage) };
  });
  step('retireDigest', () => authority.terminalDigest(JSON.stringify(evidence)));
  step('inventoryOrder', () =>
    JSON.stringify(
      shutdown.ownedShutdownInventorySchema.parse({
        attempts: [{ exit: { signal: 9, exitCode: 2 }, state: 'exited', epoch: ids.epoch, instanceId: ids.a, slot: 7 }],
        epoch: ids.epoch,
      }),
    ),
  );
  console.log(JSON.stringify({ results }));
} else if (scenario === 'shutdown') {
  const attempt = (state: string, exit?: object) => ({
    slot: 0,
    instanceId: ids.a,
    epoch: ids.epoch,
    state,
    ...(exit ? { exit } : {}),
  });
  type Plan = {
    inventories: unknown[];
    stopFails?: boolean;
    prepare?: 'ok' | 'fail';
    preserve?: 'ok' | 'fail' | 'absent';
    inventoryFails?: boolean;
    owns?: boolean;
  };
  const plans: Record<string, Plan> = {
    ready: { inventories: [[attempt('running')], [attempt('exited', { exitCode: 0 })]], prepare: 'ok' },
    stopTransport: { inventories: [[attempt('running')]], stopFails: true },
    preserved: { inventories: [[attempt('exited', { exitCode: 0 })]], prepare: 'fail', preserve: 'ok' },
    retirementUnavailable: { inventories: [[attempt('exited', { exitCode: 0 })]], prepare: 'fail', preserve: 'absent' },
    preserveFails: { inventories: [[attempt('exited', { exitCode: 0 })]], prepare: 'fail', preserve: 'fail' },
    ownershipLost: { inventories: [[attempt('ownership_lost')]] },
    inventoryFails: { inventories: [], inventoryFails: true },
    notOwned: { inventories: [[attempt('running')]], owns: false },
    startingTimeout: { inventories: [[attempt('starting')]] },
    runningTimeout: { inventories: [[attempt('running')]] },
  };
  for (const [name, plan] of Object.entries(plans)) {
    let now = 0;
    let calls = 0;
    const stops: string[] = [];
    const inventory = (index: number) => ({
      epoch: ids.epoch,
      attempts: plan.inventories[Math.min(index, plan.inventories.length - 1)],
    });
    const ports = {
      current: () => true,
      inventory: async () => {
        if (plan.inventoryFails) throw new Error('synthetic');
        return inventory(calls++);
      },
      owns: () => plan.owns ?? true,
      stop: async (a: { instanceId: string }) => {
        stops.push(a.instanceId);
        if (plan.stopFails) throw new Error('synthetic');
      },
      prepareRetirement: async () => {
        if (plan.prepare !== 'ok') throw new Error('synthetic');
        return { evidence: inventory(calls - 1), challenge: 'synthetic' };
      },
      ...(plan.preserve === 'absent'
        ? {}
        : {
            preserveExit: async () => {
              if (plan.preserve !== 'ok') throw new Error('synthetic');
              return { status: 'leader_exited_retirement_pending', evidence: inventory(calls - 1) };
            },
          }),
      now: () => now,
      wait: async (ms: number) => {
        now += ms;
      },
    };
    const machine = new shutdown.OwnedTerminalShutdown(ports, 200);
    const first = await machine.run();
    const second = plan.stopFails ? await machine.run() : undefined;
    results.push([name, first, second ?? null, stops]);
  }
  step('badDeadline', () => new shutdown.OwnedTerminalShutdown({} as never, 0));
  console.log(JSON.stringify({ results }));
} else throw new Error(`unknown scenario ${scenario}`);
