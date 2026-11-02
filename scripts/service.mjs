import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  lstatSync,
  openSync,
  closeSync,
  chmodSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createConnection } from 'node:net';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'runtime-dir': { type: 'string' } },
});
const command = positionals[0] ?? 'status';
const label = 'dev.orqst.bridge';
const domain = `gui/${process.getuid?.() ?? 0}`;
const target = `${domain}/${label}`;
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const runtime = resolve(
  values['runtime-dir'] ?? join(homedir(), '.local', 'share', 'orqst', 'toolchain'),
);
const node = join(runtime, 'bin', 'node');
function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
function integer(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return String(value);
}
function configuration() {
  return {
    ORQST_PORT: integer('ORQST_PORT', 4317, 1024, 65535),
    ORQST_DATA_DIR: resolve(process.env.ORQST_DATA_DIR ?? join(homedir(), '.orqst')),
    ORQST_CODEX_SESSIONS: resolve(
      process.env.ORQST_CODEX_SESSIONS ??
        join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions'),
    ),
    ORQST_RETENTION_DAYS: integer('ORQST_RETENTION_DAYS', 30, 1, 3650),
    ORQST_POLL_MS: integer('ORQST_POLL_MS', 3000, 500, 60000),
    ORQST_DEV: '0',
    PATH: `${join(runtime, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,
  };
}
function plan() {
  const env = configuration();
  const logDir = join(env.ORQST_DATA_DIR, 'logs');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(join(root, 'dist', 'bridge.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(env)
    .map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`)
    .join('\n')}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(join(logDir, 'bridge.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(logDir, 'bridge.stderr.log'))}</string>
</dict></plist>\n`;
  return {
    label,
    target,
    plistPath,
    node,
    runtime,
    project: root,
    environment: env,
    logDir,
    plist,
  };
}
function launch(...args) {
  return execFileSync('/bin/launchctl', args, {
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function serviceStatus() {
  const result = spawnSync('/bin/launchctl', ['print', target], {
    encoding: 'utf8',
    timeout: 10000,
  });
  const text = result.status === 0 ? result.stdout : '';
  return {
    label,
    target,
    installed: existsSync(plistPath),
    loaded: result.status === 0,
    state: /\bstate = ([^\n]+)/.exec(text)?.[1]?.trim() ?? 'not_loaded',
    pid: Number(/\bpid = (\d+)/.exec(text)?.[1] ?? 0) || null,
  };
}
function assertManagedPlist() {
  if (!existsSync(plistPath)) return;
  if (lstatSync(plistPath).isSymbolicLink())
    throw new Error('Service plist must not be a symlink.');
  const text = readFileSync(plistPath, 'utf8');
  if (
    !text.includes(`<string>${label}</string>`) ||
    !text.includes(`<string>${xml(root)}</string>`)
  )
    throw new Error(
      'Existing service belongs to a different checkout; it will not be overwritten.',
    );
}
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(port) });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}
async function ready(port) {
  const until = Date.now() + 25000;
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1500),
      });
      await response.arrayBuffer();
      const pid = serviceStatus().pid;
      const listener = pid
        ? spawnSync(
            '/usr/sbin/lsof',
            ['-nP', '-a', '-p', String(pid), `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
            { encoding: 'utf8', timeout: 3000 },
          )
        : undefined;
      if (response.ok && pid && listener?.status === 0 && listener.stdout.trim() === String(pid))
        return;
    } catch {
      /* launchd may briefly throttle a restart. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Service did not become healthy; inspect the private logs.');
}
function privateLog(path) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink())
    throw new Error('Service log must not be a symlink.');
  const fd = openSync(path, 'a', 0o600);
  closeSync(fd);
  chmodSync(path, 0o600);
}
async function install() {
  const definition = plan();
  if (
    !existsSync(join(root, 'dist', 'bridge.mjs')) ||
    !existsSync(join(root, 'apps', 'dashboard', 'dist', 'index.html'))
  )
    throw new Error('Run pnpm build before installing the service.');
  if (
    !existsSync(node) ||
    !/^v24\./.test(execFileSync(node, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim())
  )
    throw new Error('Install the private Node 24 runtime first with pnpm runtime:install.');
  assertManagedPlist();
  const old = existsSync(plistPath) ? readFileSync(plistPath, 'utf8') : undefined;
  const wasLoaded = serviceStatus().loaded;
  if (!wasLoaded && (await portOpen(definition.environment.ORQST_PORT)))
    throw new Error(
      'The port is already in use by an unmanaged process. Stop the verified ORQST process before installation.',
    );
  mkdirSync(dirname(plistPath), { recursive: true, mode: 0o700 });
  mkdirSync(definition.logDir, { recursive: true, mode: 0o700 });
  if (lstatSync(definition.logDir).isSymbolicLink())
    throw new Error('Service log directory must not be a symlink.');
  chmodSync(definition.logDir, 0o700);
  privateLog(join(definition.logDir, 'bridge.stdout.log'));
  privateLog(join(definition.logDir, 'bridge.stderr.log'));
  const staged = plistPath + `.${process.pid}.pending`;
  try {
    writeFileSync(staged, definition.plist, { mode: 0o600, flag: 'wx' });
    execFileSync('/usr/bin/plutil', ['-lint', staged], { stdio: 'pipe', timeout: 10000 });
    if (wasLoaded) launch('bootout', target);
    renameSync(staged, plistPath);
    try {
      launch('bootstrap', domain, plistPath);
      await ready(definition.environment.ORQST_PORT);
    } catch (error) {
      if (serviceStatus().loaded) launch('bootout', target);
      if (old !== undefined) {
        writeFileSync(plistPath, old, { mode: 0o600 });
        if (wasLoaded) launch('bootstrap', domain, plistPath);
      } else rmSync(plistPath, { force: true });
      throw error;
    }
  } finally {
    rmSync(staged, { force: true });
  }
  return {
    ...serviceStatus(),
    url: `http://127.0.0.1:${definition.environment.ORQST_PORT}`,
    node,
    logDirectory: definition.logDir,
  };
}
try {
  process.umask(0o077);
  if (command === 'plan') console.log(JSON.stringify(plan(), null, 2));
  else {
    if (process.platform !== 'darwin')
      throw new Error('The managed service currently supports macOS only.');
    if (command === 'status') console.log(JSON.stringify(serviceStatus(), null, 2));
    else if (command === 'install') console.log(JSON.stringify(await install(), null, 2));
    else if (command === 'restart') {
      assertManagedPlist();
      if (!serviceStatus().loaded) throw new Error('Install the service before restarting it.');
      launch('kickstart', '-k', target);
      const port = execFileSync(
        '/usr/bin/plutil',
        ['-extract', 'EnvironmentVariables.ORQST_PORT', 'raw', '-o', '-', plistPath],
        { encoding: 'utf8', timeout: 10000 },
      ).trim();
      if (!/^\d+$/.test(port)) throw new Error('Installed service port is invalid.');
      await ready(port);
      console.log(JSON.stringify(serviceStatus(), null, 2));
    } else if (command === 'uninstall') {
      assertManagedPlist();
      if (serviceStatus().loaded) launch('bootout', target);
      rmSync(plistPath, { force: true });
      console.log(
        JSON.stringify(
          { label, installed: false, dataPreserved: true, runtimePreserved: true },
          null,
          2,
        ),
      );
    } else throw new Error('Use plan, install, status, restart or uninstall.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
