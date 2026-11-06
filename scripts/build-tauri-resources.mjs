import { build } from 'esbuild';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Native builds only. A cross-target Node binary must never be guessed from PATH.
if (!/^v24\./.test(process.version)) throw new Error('Tauri resources require Node 24');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'apps/tauri/dist');
const native = join(root, 'apps/tauri/src-tauri');
const target = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (\S+)$/m)?.[1];
if (!target) throw new Error('Could not determine the native Rust target');
const nodeLicensePath = process.env.ORQST_NODE_LICENSE;
if (!nodeLicensePath) {
  throw new Error('Set ORQST_NODE_LICENSE to the LICENSE shipped with this exact Node 24 binary');
}
const nodeLicense = await readFile(nodeLicensePath, 'utf8');
if (!nodeLicense.startsWith('Node.js is licensed for use as follows:')) {
  throw new Error('The Node distribution LICENSE is required, including its third-party notices');
}
await mkdir(join(output, 'core'), { recursive: true });
await mkdir(join(output, 'licenses'), { recursive: true });
await mkdir(join(native, 'binaries'), { recursive: true });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nodeName = `orqst-node-${target}${process.platform === 'win32' ? '.exe' : ''}`;
const nodeTarget = join(native, 'binaries', nodeName);
// Prefer a standalone copy-on-write runtime where available; integrity checks remain mandatory.
await cp(process.execPath, nodeTarget, { mode: constants.COPYFILE_FICLONE });
const nodeHash = sha256(await readFile(process.execPath));
if (sha256(await readFile(nodeTarget)) !== nodeHash) throw new Error('Node copy integrity failure');

const result = await build({
  entryPoints: {
    'desktop-sidecar': 'apps/bridge/src/desktop-sidecar.ts',
    'analytics-worker': 'apps/bridge/src/analytics-worker.ts',
  },
  absWorkingDir: root,
  outdir: join(output, 'core'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  // Bundled CommonJS dependencies may still require Node builtins.
  banner: {
    js: "import { createRequire as nodeRequire } from 'node:module'; const require = nodeRequire(import.meta.url);",
  },
  metafile: true,
});
// Reuse the exact existing Node hosts and terminal renderer; no Electron runtime is shipped.
const terminalResult = await build({
  entryPoints: {
    'tauri-agents-host': 'apps/desktop/src/tauri-agents-host.ts',
    'tauri-files-host': 'apps/desktop/src/tauri-files-host.ts',
    'managed-agents-host': 'apps/desktop/src/managed-agents-host.ts',
    'codex-structured-host': 'packages/core/src/managed-codex/native-host.ts',
    'tauri-terminal-host': 'apps/desktop/src/tauri-terminal-host.ts',
    'tauri-terminal-preparation-host': 'apps/desktop/src/tauri-terminal-preparation-host.ts',
    'tauri-offline-recovery-host': 'apps/desktop/src/tauri-offline-recovery-host.ts',
    'managed-terminal-core': 'packages/core/src/terminal/host.ts',
    'managed-terminal-host': 'packages/core/src/terminal/pty-host.ts',
    'orqst-mcp-relay': 'packages/core/src/terminal/mcp-relay.ts',
  },
  absWorkingDir: root,
  outdir: join(output, 'core'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['node-pty'],
  metafile: true,
});
const clientResult = await build({
  entryPoints: {
    client: 'apps/tauri/src/terminal-client.ts',
    style: 'apps/desktop/src/managed-terminal.css',
  },
  absWorkingDir: root,
  outdir: join(output, 'terminal'),
  bundle: true,
  platform: 'browser',
  target: 'safari17',
  format: 'iife',
  metafile: true,
});
const filesClientResult = await build({
  entryPoints: { client: 'apps/tauri/src/files-client.ts' },
  absWorkingDir: root,
  outdir: join(output, 'files'),
  bundle: true,
  platform: 'browser',
  target: 'safari17',
  format: 'iife',
  metafile: true,
});
const featuresClientResult = await build({
  entryPoints: {
    client: 'apps/tauri/src/features-client.ts',
    studio: 'apps/tauri/src/studio-client.ts',
    workspace: 'apps/tauri/src/feature-workspace-client.ts',
  },
  absWorkingDir: root,
  outdir: join(output, 'features'),
  bundle: true,
  platform: 'browser',
  target: 'safari17',
  format: 'iife',
  metafile: true,
});
const agentsClientResult = await build({
  entryPoints: {
    client: 'apps/tauri/src/agents-client.ts',
    style: 'apps/desktop/src/managed-agents.css',
  },
  absWorkingDir: root,
  outdir: join(output, 'agents'),
  bundle: true,
  platform: 'browser',
  target: 'safari17',
  format: 'iife',
  metafile: true,
});
if (process.platform === 'darwin' && process.arch === 'arm64') {
  const require = createRequire(import.meta.url);
  const source = dirname(require.resolve('node-pty/package.json'));
  const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (metadata.version !== '1.1.0' || metadata.license !== 'MIT')
    throw new Error('Unexpected PTY dependency');
  const destination = join(output, 'core/terminal-pty');
  await mkdir(join(destination, 'prebuilds/darwin-arm64'), { recursive: true });
  await cp(join(source, 'lib'), join(destination, 'lib'), { recursive: true });
  for (const file of ['package.json', 'LICENSE'])
    await cp(join(source, file), join(destination, file));
  for (const file of ['pty.node', 'spawn-helper'])
    await cp(
      join(source, 'prebuilds/darwin-arm64', file),
      join(destination, 'prebuilds/darwin-arm64', file),
    );
  await chmod(join(destination, 'prebuilds/darwin-arm64/spawn-helper'), 0o700);
}
// Rust terminal Core (ORQST_RUST_TERMINALS=1 pilot). Always staged; Node stays the default.
const rustCore = join(root, 'apps/tauri/terminal-core/Cargo.toml');
execFileSync('cargo', ['build', '--release', '--locked', '--manifest-path', rustCore], {
  stdio: 'inherit',
});
const rustTarget = process.env.CARGO_TARGET_DIR ?? join(root, 'apps/tauri/terminal-core/target');
await cp(join(rustTarget, 'release/orqst-terminal-core'), join(output, 'core/orqst-terminal-core'));
await chmod(join(output, 'core/orqst-terminal-core'), 0o700);
// Rust dependency notices: only reviewed licenses; every package ships its license text.
const rustLicenses = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-3-Clause',
  'BSD-2-Clause',
  'ISC',
  'Zlib',
  'Unicode-3.0',
  'Unlicense',
  'CC0-1.0',
  'Apache-2.0 WITH LLVM-exception',
]);
const rustAllowed = (expression) =>
  expression
    .replace(/[()]/g, '')
    .split(/\s+OR\s+|\//)
    .some((alternative) =>
      alternative.split(/\s+AND\s+/).every((part) => rustLicenses.has(part.trim())),
    );
const metadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--format-version',
      '1',
      '--locked',
      '--filter-platform',
      target,
      '--manifest-path',
      rustCore,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ),
);
const rustPackages = [];
const resolved = new Set(metadata.resolve.nodes.map((node) => node.id));
for (const item of metadata.packages) {
  if (!resolved.has(item.id) || item.name === 'orqst-terminal-core') continue;
  if (!item.license || !rustAllowed(item.license))
    throw new Error(`Unreviewed Rust dependency license: ${item.name} ${item.license}`);
  const directory = dirname(item.manifest_path);
  const notices = (await readdir(directory)).filter((name) =>
    /^(licen[cs]e|notice|copying|unlicense)([.-]|$)/i.test(name),
  );
  if (notices.length === 0) throw new Error(`Missing Rust license text: ${item.name}`);
  const key = `rust-${item.name}-${item.version}`;
  await mkdir(join(output, 'licenses', key), { recursive: true });
  for (const name of notices)
    if ((await stat(join(directory, name))).isFile())
      await cp(join(directory, name), join(output, 'licenses', key, name));
  rustPackages.push({ name: item.name, version: item.version, license: item.license, notices });
}
await writeFile(
  join(output, 'licenses/rust-terminal-core.json'),
  JSON.stringify(rustPackages, null, 2) + '\n',
);
await cp(join(root, 'apps/dashboard/dist'), join(output, 'dashboard'), { recursive: true });
for (const file of ['LICENSE', 'NOTICE'])
  await cp(join(root, file), join(output, 'licenses', file));
await writeFile(join(output, 'licenses/Node-LICENSE'), nodeLicense);

// Include licenses from the actual Core bundle and the dashboard dependency closure.
const packages = new Map();
async function packageAt(file) {
  let directory = dirname(await realpath(file));
  while (directory !== dirname(directory)) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.name) return { directory, manifest };
    } catch {
      // An input may be below a directory without a package manifest.
    }
    directory = dirname(directory);
  }
  throw new Error('Could not identify a bundled dependency license');
}
async function includePackage(file) {
  const found = await packageAt(file);
  const { directory, manifest } = found;
  if (manifest.name.startsWith('@orqst/') || packages.has(manifest.name)) return;
  // These are the licenses in the selected closure. New grants need explicit review.
  if (!['MIT', 'ISC', 'Apache-2.0', 'Apache-2.0 OR MIT'].includes(manifest.license)) {
    throw new Error(`Unreviewed bundled dependency license: ${manifest.name}`);
  }
  const key = manifest.name.replaceAll('/', '-');
  const notices = (await readdir(directory)).filter((name) =>
    /^(licen[cs]e|notice|copying)([.-]|$)/i.test(name),
  );
  if (notices.length === 0) throw new Error(`Missing dependency license text: ${manifest.name}`);
  packages.set(manifest.name, {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    notices,
  });
  await mkdir(join(output, 'licenses', key), { recursive: true });
  for (const name of notices) {
    if (!(await stat(join(directory, name))).isFile())
      throw new Error('Unsupported license directory');
    await cp(join(directory, name), join(output, 'licenses', key, name));
  }
  return found;
}
for (const input of Object.keys({
  ...result.metafile.inputs,
  ...terminalResult.metafile.inputs,
  ...clientResult.metafile.inputs,
  ...agentsClientResult.metafile.inputs,
  ...filesClientResult.metafile.inputs,
  ...featuresClientResult.metafile.inputs,
})) {
  if (input.includes('node_modules/')) await includePackage(resolve(root, input));
}
async function includeDependencies(manifestFile) {
  const require = createRequire(manifestFile);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (name.startsWith('@orqst/') || packages.has(name)) continue;
    // A package such as @babel/runtime can export only subpaths, without a main.
    let dependencyManifest;
    for (const directory of require.resolve.paths(name) ?? []) {
      const candidate = join(directory, name, 'package.json');
      try {
        if ((await stat(candidate)).isFile()) {
          dependencyManifest = candidate;
          break;
        }
      } catch {
        // Continue along Node's package search locations.
      }
    }
    if (!dependencyManifest) throw new Error(`Unresolved bundled dependency: ${name}`);
    const found = await includePackage(dependencyManifest);
    if (found) await includeDependencies(join(found.directory, 'package.json'));
  }
}
await includeDependencies(join(root, 'apps/dashboard/package.json'));
await includePackage(createRequire(import.meta.url).resolve('node-pty/package.json'));
await writeFile(
  join(output, 'licenses/dependencies.json'),
  JSON.stringify([...packages.values()], null, 2) + '\n',
);
await writeFile(
  join(output, 'core/runtime.json'),
  JSON.stringify(
    {
      target,
      nodeVersion: process.version,
      nodeSha256: nodeHash,
      nodeLicenseSha256: sha256(nodeLicense),
    },
    null,
    2,
  ) + '\n',
);
console.log(`Staged Tauri Core, dashboard and ${packages.size} dependency notices for ${target}.`);
