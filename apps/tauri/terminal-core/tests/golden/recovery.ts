// SYNTHETIC golden driver for lane L6 (offline recovery of owned terminal reservations).
// Builds clearly-labeled synthetic reservation trees in disposable temp directories with the
// TypeScript code and runs the TypeScript recovery on them. Boot identities are injected; the
// real sysctl is never called. Never point <base> at real Application Support data.
// Usage: tsx recovery.ts build <base> <variant>
//        tsx recovery.ts snapshot <base>
//        tsx recovery.ts step <base> <op> <boot> <approve 1|0> <uuidSeed> [bundle]
//        tsx recovery.ts host <base> <boot> <uuidSeed> <script-json>
//        tsx recovery.ts anchor <parent>
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const crypto = require('node:crypto') as typeof import('node:crypto');
let seed = 0;
let counter = 0;
const synthetic = () =>
  `${seed.toString(16).padStart(8, '0')}-0000-4000-8000-${(counter++).toString(16).padStart(12, '0')}`;
const realUUID = crypto.randomUUID;
let deterministic = false;
(crypto as { randomUUID: () => string }).randomUUID = () =>
  deterministic ? synthetic() : realUUID();
syncBuiltinESMExports();
performance.now = () => 1000;

const root = '../../../../../packages/core/src';
const desktop = '../../../../../apps/desktop/src';
const offline = await import(`${root}/terminal/offline-recovery.js`);
const files = await import(`${root}/terminal/offline-recovery-files.js`);
const enrollment = await import(`${root}/terminal/enrollment-files.js`);
const authority = await import(`${root}/terminal/authority.js`);
const { terminalJournalMigration } =
  await import('../../../../../packages/database/src/terminal-journal.js');
const { stableId } = await import('../../../../../packages/shared/src/index.js');
const wire = await import(`${desktop}/offline-recovery-wire.js`);
const host = await import(`${desktop}/tauri-offline-recovery.js`);
const anchorModule = await import(`${desktop}/offline-recovery-anchor.js`);

const SEED = Buffer.alloc(32, 7); // SYNTHETIC fixed administrative key seed.
const privateKey = crypto.createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), SEED]),
  format: 'der',
  type: 'pkcs8',
});
const publicKey = crypto.createPublicKey(privateKey);
const ids = {
  owner: '11111111-1111-4111-8111-111111111111',
  epoch: '22222222-2222-4222-8222-222222222222',
  terminalA: '33333333-3333-4333-8333-333333333333',
  terminalB: '44444444-4444-4444-8444-444444444444',
  op: '55555555-5555-4555-8555-555555555555',
  attempt: '66666666-6666-4666-8666-666666666666',
  otherEpoch: '77777777-7777-4777-8777-777777777777',
  anchorId: '88888888-8888-4888-8888-888888888888',
  anchorNonce: '99999999-9999-4999-8999-999999999999',
};

function classify(error: unknown): string {
  if (error instanceof offline.OfflineRecoveryBlocked) return `blocked:${error.reason}`;
  if (error instanceof files.OfflineEnrollmentBindingChanged) return 'enrollment_binding_changed';
  const e = error as { name?: string; code?: string; message?: string };
  if (e.name === 'ZodError' || e.name === 'SyntaxError') return 'invalid';
  if (typeof e.code === 'string' && /^E[A-Z]+$/.test(e.code)) return e.code;
  return e.message ?? String(error);
}

function dir(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}
function file(path: string, text: string | Buffer) {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function journal(
  state: string,
  project: string,
  options: { wal?: boolean; state?: string; epoch?: string } = {},
) {
  const path = join(state, 'terminal.sqlite');
  const db = new DatabaseSync(path);
  db.exec(
    options.wal
      ? 'PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0'
      : 'PRAGMA journal_mode=DELETE',
  );
  db.exec(terminalJournalMigration);
  const epoch = options.epoch ?? ids.epoch;
  db.prepare('INSERT INTO terminal_owner VALUES (1, ?)').run(epoch);
  const attempt = {
    instanceId: ids.attempt,
    epoch,
    clientId: 'synthetic-client',
    projectId: authority.terminalDigest(project),
    manifestDigest: 'a'.repeat(64),
    state: options.state ?? 'prepared',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
  db.prepare('INSERT INTO terminal_attempts VALUES (?,?,?,?,?,?)').run(
    attempt.instanceId,
    attempt.epoch,
    attempt.projectId,
    attempt.state,
    attempt.updatedAt,
    JSON.stringify(attempt),
  );
  if (options.wal) {
    copyFileSync(`${path}-wal`, join(state, 'wal.copy'));
    db.close();
    renameSync(join(state, 'wal.copy'), `${path}-wal`);
    chmodSync(`${path}-wal`, 0o600);
  } else db.close();
  chmodSync(path, 0o600);
}

function config(
  base: string,
  slot: number,
  project: string,
  terminalId: string,
  extra: object = {},
) {
  const state = dir(join(base, `state-${slot}`));
  return {
    version: 1,
    trust: 'native-same-user',
    executable: { path: join(base, 'bin', 'codex'), sha256: 'b'.repeat(64) },
    executableVersion: '0.0.0-synthetic',
    node: { path: join(base, 'bin', 'node'), sha256: 'c'.repeat(64) },
    identity: { terminalId },
    project,
    state,
    ...extra,
  };
}

function writeAnchor(parent: string) {
  const anchor = dir(join(parent, 'administrative-recovery', 'anchor'));
  dir(join(parent, 'administrative-recovery', 'bundles'));
  const installation = {
    domain: 'orqst.administrative-anchor-installation',
    version: 1,
    id: ids.anchorId,
    directory: anchor,
    fingerprint: authority.terminalDigest(publicKey.export({ type: 'spki', format: 'der' })),
    nonce: ids.anchorNonce,
    expiresAt: 31000,
  };
  file(
    join(anchor, 'identity.json'),
    JSON.stringify({
      installation,
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      signature: crypto
        .sign(null, Buffer.from(JSON.stringify(installation)), privateKey)
        .toString('base64url'),
    }),
  );
}

function build(base: string, variant: string) {
  const parent = dir(join(base, 'parent'));
  const directory = dir(join(parent, 'managed-agents'));
  writeAnchor(parent);
  dir(join(base, 'bin'));
  file(join(base, 'bin', 'codex'), '#!/bin/sh\n# SYNTHETIC\n');
  file(join(base, 'bin', 'node'), '#!/bin/sh\n# SYNTHETIC\n');
  const project = dir(join(base, 'project'));
  const otherProject = dir(join(base, 'project-other'));
  dir(join(base, 'manifests'));
  const manifestA = join(base, 'manifests', 'a.json');
  const configA = config(base, 0, project, ids.terminalA);
  file(manifestA, JSON.stringify(configA));
  journal(configA.state, project, {
    wal: variant === 'wal',
    state: variant === 'not-prepared' ? 'starting' : 'prepared',
  });
  if (variant === 'shm') file(join(configA.state, 'terminal.sqlite-shm'), Buffer.alloc(32768));
  if (variant === 'lifecycle') file(join(configA.state, 'lifecycle-synthetic.json'), '{}');
  if (variant === 'rollback') file(join(configA.state, 'terminal.sqlite-journal'), '');
  const manifests =
    variant === 'no-manifests'
      ? []
      : variant === 'duplicate'
        ? [manifestA, manifestA]
        : [manifestA];
  file(
    join(directory, 'active-pair.json'),
    JSON.stringify({
      version: 1,
      owner: ids.owner,
      manifests,
      epoch: variant === 'bad-epoch' ? ids.otherEpoch : ids.epoch,
    }),
  );
  if (variant === 'retired') file(join(directory, `retired-${ids.owner}-${ids.op}.json`), '{}');
  if (
    ['enrollment', 'orphan', 'uncertain-receipt', 'mixed-project', 'binding-changed'].includes(
      variant,
    )
  ) {
    const projectB = variant === 'mixed-project' ? otherProject : project;
    const manifestB = join(base, 'manifests', 'b.json');
    const configB = config(base, 1, projectB, ids.terminalB, {
      preparation: {
        observerDatabase: join(base, 'observer.sqlite'),
        preferencesDirectory: join(base, 'preferences'),
        workspaceId: stableId('workspace', projectB),
        featureId: null,
        fence: 'synthetic-fence',
      },
    });
    file(manifestB, JSON.stringify(configB));
    journal(configB.state, projectB);
    const binding = enrollment.terminalEnrollmentFile(manifestB, configB);
    const input = {
      version: 1,
      epoch: ids.epoch,
      opId: ids.op,
      expectedRevision: 0,
      workspaceId: stableId('workspace', projectB),
      featureId: null,
    };
    const member = {
      slot: 1,
      terminalId: ids.terminalB,
      provider: 'codex',
      workspaceId: input.workspaceId,
      featureId: null,
      admissionRevision: 1,
      bindingDigest: variant === 'binding-changed' ? 'd'.repeat(64) : binding.bindingDigest,
    };
    const name = `enrollment-${ids.owner}-${ids.op}`;
    if (variant !== 'orphan')
      file(
        join(directory, `${name}.json`),
        JSON.stringify({
          version: 1,
          owner: ids.owner,
          input,
          manifestFile: manifestB,
          member: { ...member, status: 'uncertain' },
        }),
      );
    const status = variant === 'uncertain-receipt' ? 'uncertain' : 'ready';
    file(
      join(directory, `${name}.receipt.json`),
      JSON.stringify({
        version: 1,
        owner: ids.owner,
        receipt: {
          ...input,
          revision: 1,
          status,
          reason: status === 'ready' ? 'admitted' : 'effect_uncertain',
          member: { ...member, status },
        },
      }),
    );
  }
  return { ok: true };
}

const reviews: unknown[] = [];
function recovery(boot: string, approve: boolean) {
  return new offline.OfflineReservationRecovery(
    {
      publicKey,
      review: async (intent: unknown, review: string, fingerprint: string) => {
        reviews.push({ intent, fingerprint, review });
        return approve;
      },
      sign: async (challenge: { expiresAt: number }) => ({
        signature: crypto
          .sign(null, offline.administrativeRecoveryBytes(challenge), privateKey)
          .toString('base64url'),
        validUntil: challenge.expiresAt,
      }),
      revalidate: async (challenge: { expiresAt: number }) => challenge.expiresAt,
    },
    { bootUUID: () => boot, now: () => 1000 },
  );
}

const [command, base] = [process.argv[2]!, process.argv[3]!];
let output: unknown;
if (command === 'build') output = build(base, process.argv[4]!);
else if (command === 'anchor') {
  try {
    output = { ok: anchorModule.loadAdministrativeAnchor(base).installation };
  } catch (error) {
    output = { error: classify(error) };
  }
} else if (command === 'snapshot') {
  const scratch = dir(join(base, `scratch-ts-${Date.now()}-${Math.random()}`));
  try {
    output = {
      ok: files.snapshotOfflineReservation(join(base, 'parent', 'managed-agents'), scratch),
    };
  } catch (error) {
    output = { error: classify(error) };
  }
  rmSync(scratch, { recursive: true });
} else if (command === 'step') {
  const [op, boot, approve, uuidSeed, bundle] = process.argv.slice(4);
  seed = Number(uuidSeed);
  deterministic = true;
  const engine = recovery(boot!, approve === '1');
  const parent = join(base, 'parent');
  let result: unknown;
  try {
    result = {
      ok:
        op === 'capture'
          ? await engine.capture(
              join(parent, 'managed-agents'),
              join(parent, 'administrative-recovery', 'bundles'),
            )
          : await engine[op as 'release'](bundle!),
    };
  } catch (error) {
    result = { error: classify(error) };
  }
  output = { result, reviews };
} else if (command === 'host') {
  const [boot, uuidSeed, script] = process.argv.slice(4);
  seed = Number(uuidSeed);
  deterministic = true;
  const plan = JSON.parse(script!) as Array<{
    action: string;
    bundle: string | null;
    approve: boolean;
  }>;
  const frames: unknown[] = [];
  let pipe: InstanceType<typeof wire.AdministrativeReviewPipe>;
  const send = (value: Record<string, unknown>) => {
    frames.push(['out', value]);
    const approved = current?.approve ?? false;
    if (value.kind === 'review') {
      const reply = {
        kind: 'answer',
        session: value.session,
        id: value.id,
        nonce: value.nonce,
        digest: value.digest,
        approved,
      };
      frames.push(['in', reply]);
      setImmediate(() => pipe.answer(reply));
    } else if (value.kind === 'authorize') {
      const reply = {
        kind: 'authorized',
        session: value.session,
        id: value.id,
        nonce: value.nonce,
        digest: value.digest,
        requestNonce: value.requestNonce,
        proofDigest: value.proofDigest,
        remainingMs: 30000,
      };
      frames.push(['in', reply]);
      setImmediate(() => pipe.authorized(reply));
    }
  };
  let current: (typeof plan)[number] | undefined;
  pipe = new wire.AdministrativeReviewPipe(send);
  const engine = new host.TauriOfflineRecovery(join(base, 'parent'), pipe, {
    bootUUID: () => boot!,
    now: () => 1000,
  });
  frames.push(['out', { kind: 'ready', version: 2, session: pipe.session }]);
  let id = 0;
  for (const step of plan) {
    current = step;
    const request = {
      kind: 'action',
      session: pipe.session,
      id: ++id,
      action: step.action,
      bundle: step.bundle,
    };
    frames.push(['in', request]);
    try {
      const outcome = await engine.receive(request);
      frames.push([
        'out',
        { kind: 'complete', session: pipe.session, id, status: 'done', outcome },
      ]);
    } catch (error) {
      frames.push([
        'out',
        {
          kind: 'complete',
          session: pipe.session,
          id,
          ...host.administrativeBlockedOutcome(error),
        },
      ]);
    }
  }
  pipe.close();
  output = { frames };
}
process.stdout.write(JSON.stringify(output));
