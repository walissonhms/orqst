import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';
import { lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { terminalDigest } from '../../../packages/core/src/terminal/authority.js';
import { terminalDirectory } from '../../../packages/core/src/terminal/codex-profile.js';
import {
  readRecoveryFile,
  syncRecoveryDirectory,
  writeRecoveryFile,
} from '../../../packages/core/src/terminal/offline-recovery-files.js';

const installationSchema = z.strictObject({
  domain: z.literal('orqst.administrative-anchor-installation'),
  version: z.literal(1),
  id: z.uuid(),
  directory: z.string().startsWith('/').max(2048),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  nonce: z.uuid(),
  expiresAt: z.number().finite(),
});
const envelopeSchema = z.strictObject({
  installation: installationSchema,
  publicKey: z.string().min(1).max(1024),
  privateKey: z.string().min(1).max(1024),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});

/** Native-owned AppData only. No capture, renderer, runtime epoch or environment key discovery. */
export function recoveryLocations(parent: string) {
  terminalDirectory(parent, true);
  const root = join(parent, 'administrative-recovery');
  return {
    root,
    anchor: join(root, 'anchor'),
    bundles: join(root, 'bundles'),
    admission: join(parent, 'managed-agents'),
  };
}

function privateDirectory(path: string) {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  terminalDirectory(path, true);
  syncRecoveryDirectory(path);
}

export function loadAdministrativeAnchor(parent: string) {
  const paths = recoveryLocations(parent);
  terminalDirectory(paths.root, true);
  terminalDirectory(paths.anchor, true);
  if ((lstatSync(paths.anchor).mode & 0o777) !== 0o700)
    throw new Error('Administrative anchor directory mode');
  const source = readRecoveryFile(join(paths.anchor, 'identity.json'), 8192);
  if ((BigInt(source.identity[3]!) & 0o777n) !== 0o600n)
    throw new Error('Administrative anchor file mode');
  const envelope = envelopeSchema.parse(
    JSON.parse(Buffer.from(source.bytes, 'base64').toString('utf8')),
  );
  const privateKey = createPrivateKey(envelope.privateKey);
  const publicKey = createPublicKey(envelope.publicKey);
  if (
    privateKey.asymmetricKeyType !== 'ed25519' ||
    publicKey.asymmetricKeyType !== 'ed25519' ||
    !createPublicKey(privateKey).equals(publicKey) ||
    envelope.installation.directory !== paths.anchor ||
    terminalDigest(publicKey.export({ type: 'spki', format: 'der' })) !==
      envelope.installation.fingerprint ||
    !verify(
      null,
      Buffer.from(JSON.stringify(envelope.installation)),
      publicKey,
      Buffer.from(envelope.signature, 'base64url'),
    )
  )
    throw new Error('Untrusted administrative anchor');
  return { publicKey, privateKey, installation: envelope.installation, source };
}

/** A failed/partial existing installation is preserved, never repaired, rotated or adopted. */
export async function installAdministrativeAnchor(
  parent: string,
  review: (detail: string) => Promise<boolean>,
  current: () => boolean,
) {
  const paths = recoveryLocations(parent);
  try {
    lstatSync(paths.anchor);
    throw new Error('Administrative anchor already exists; preserve it');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const keys = generateKeyPairSync('ed25519');
  const installation = installationSchema.parse({
    domain: 'orqst.administrative-anchor-installation',
    version: 1,
    id: randomUUID(),
    directory: paths.anchor,
    fingerprint: terminalDigest(keys.publicKey.export({ type: 'spki', format: 'der' })),
    nonce: randomUUID(),
    expiresAt: performance.now() + 30_000,
  });
  if (
    !current() ||
    !(await review(JSON.stringify(installation, null, 2))) ||
    !current() ||
    performance.now() >= installation.expiresAt
  )
    throw new Error('Administrative anchor installation denied');
  const signature = sign(null, Buffer.from(JSON.stringify(installation)), keys.privateKey).toString(
    'base64url',
  );
  privateDirectory(paths.root);
  // Exclusive directory is part of the transaction: partial material must remain visible.
  mkdirSync(paths.anchor, { mode: 0o700 });
  syncRecoveryDirectory(paths.root);
  writeRecoveryFile(
    join(paths.anchor, 'identity.json'),
    JSON.stringify({
      installation,
      publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
      privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      signature,
    }),
  );
  privateDirectory(paths.bundles);
  syncRecoveryDirectory(parent);
  return loadAdministrativeAnchor(parent).installation;
}

export function assertAdministrativeAnchor(
  parent: string,
  expected: ReturnType<typeof loadAdministrativeAnchor>,
) {
  const current = loadAdministrativeAnchor(parent);
  if (
    current.source.bytes !== expected.source.bytes ||
    JSON.stringify(current.source.identity) !== JSON.stringify(expected.source.identity)
  )
    throw new Error('Administrative anchor changed');
}
