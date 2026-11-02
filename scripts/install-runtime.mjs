import {
  cpSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  existsSync,
  lstatSync,
  chmodSync,
  symlinkSync,
  realpathSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: { node: { type: 'string' }, pnpm: { type: 'string' }, destination: { type: 'string' } },
});
const node = resolve(values.node ?? process.execPath);
const pnpmEntry = values.pnpm ?? process.env.npm_execpath;
const destination = resolve(
  values.destination ?? join(homedir(), '.local', 'share', 'orqst', 'toolchain'),
);
function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
function version(binary, args) {
  return execFileSync(binary, args, { encoding: 'utf8', timeout: 10000 }).trim();
}
try {
  process.umask(0o077);
  const nodeVersion = version(node, ['--version']);
  if (!/^v24\./.test(nodeVersion))
    throw new Error('Provide a Node 24 binary using --node; global tools will not be changed.');
  if (!pnpmEntry)
    throw new Error('Run through pnpm or provide its bin/pnpm.cjs path using --pnpm.');
  const pnpmRoot = dirname(dirname(realpathSync(resolve(pnpmEntry))));
  const manifest = JSON.parse(readFileSync(join(pnpmRoot, 'package.json'), 'utf8'));
  const requested = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager;
  if (manifest.name !== 'pnpm' || requested !== `pnpm@${manifest.version}`)
    throw new Error('The pnpm source must match packageManager in package.json.');
  const nodeSha256 = digest(node);
  if (existsSync(destination)) {
    if (lstatSync(destination).isSymbolicLink())
      throw new Error('Runtime destination must not be a symlink.');
    const current = JSON.parse(readFileSync(join(destination, 'runtime.json'), 'utf8'));
    if (
      current.nodeSha256 !== nodeSha256 ||
      current.pnpmVersion !== manifest.version ||
      digest(join(destination, 'bin', 'node')) !== nodeSha256
    )
      throw new Error(
        'Existing runtime differs; select another --destination instead of overwriting it.',
      );
    if (
      version(join(destination, 'bin', 'node'), [
        join(destination, 'pnpm', 'bin', 'pnpm.cjs'),
        '--version',
      ]) !== manifest.version
    )
      throw new Error('Existing pnpm runtime is incomplete.');
    console.log(
      JSON.stringify({
        runtime: destination,
        nodeVersion,
        pnpmVersion: manifest.version,
        reused: true,
      }),
    );
  } else {
    const parent = dirname(destination);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    if (lstatSync(parent).isSymbolicLink())
      throw new Error('Runtime parent must not be a symlink.');
    const stage = mkdtempSync(join(parent, '.toolchain-'));
    try {
      mkdirSync(join(stage, 'bin'), { mode: 0o700 });
      copyFileSync(node, join(stage, 'bin', 'node'));
      chmodSync(join(stage, 'bin', 'node'), 0o755);
      cpSync(pnpmRoot, join(stage, 'pnpm'), { recursive: true, dereference: false });
      symlinkSync('../pnpm/bin/pnpm.cjs', join(stage, 'bin', 'pnpm'));
      symlinkSync('../pnpm/bin/pnpx.cjs', join(stage, 'bin', 'pnpx'));
      if (digest(join(stage, 'bin', 'node')) !== nodeSha256)
        throw new Error('Copied Node binary failed integrity verification.');
      if (
        version(join(stage, 'bin', 'node'), [
          join(stage, 'pnpm', 'bin', 'pnpm.cjs'),
          '--version',
        ]) !== manifest.version
      )
        throw new Error('Copied pnpm failed validation.');
      writeFileSync(
        join(stage, 'runtime.json'),
        JSON.stringify({ nodeVersion, pnpmVersion: manifest.version, nodeSha256 }, null, 2) + '\n',
        { mode: 0o600 },
      );
      renameSync(stage, destination);
    } catch (error) {
      rmSync(stage, { recursive: true, force: true });
      throw error;
    }
    console.log(
      JSON.stringify({
        runtime: destination,
        nodeVersion,
        pnpmVersion: manifest.version,
        reused: false,
      }),
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
