import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

export function nativeBundleIdentifier(app: string): string {
  return execFileSync(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleIdentifier', 'raw', join(app, 'Contents/Info.plist')],
    { encoding: 'utf8' },
  ).trim();
}

// Process metadata only: never launch, focus or stop an application during preflight.
// Check identity as well as path: a second copy can share the native single-instance ID.
export function assertNoResidentCoexistenceApp(app: string, identifier: string): void {
  const executable = join(app, 'Contents/MacOS/orqst-desktop');
  const processes = execFileSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8' });
  for (const command of processes.split('\n').map((line) => line.trim())) {
    if (!command.endsWith('.app/Contents/MacOS/orqst-desktop')) continue;
    const candidate = dirname(dirname(dirname(command)));
    assert.ok(
      command !== executable && nativeBundleIdentifier(candidate) !== identifier,
      'Native coexistence identity is already running; leave it untouched and quit it explicitly before retrying',
    );
  }
}
