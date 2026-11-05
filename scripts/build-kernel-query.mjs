import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Build only the metadata-query helper without modifying either app's resource tree. */
export async function buildKernelQuery() {
  const empty = await mkdtemp(join(tmpdir(), 'orqst-kernel-build-'));
  try {
    execFileSync(
      'cargo',
      [
        'build',
        '--manifest-path',
        'apps/tauri/src-tauri/Cargo.toml',
        '--bin',
        'orqst-kernel-query',
        '--release',
        '--locked',
        '-j',
        '1',
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          TAURI_CONFIG: JSON.stringify({
            build: { frontendDist: empty },
            bundle: { resources: null, externalBin: null },
          }),
        },
      },
    );
    return join(
      resolve(process.env.CARGO_TARGET_DIR ?? 'apps/tauri/src-tauri/target'),
      'release',
      'orqst-kernel-query',
    );
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
}
