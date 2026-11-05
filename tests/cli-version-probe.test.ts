import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { probeSignedCliVersion } from '../packages/core/src/terminal/cli-version-probe.js';

test('probe runs only after signature verification with a private HOME and minimal environment', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'orqst-version-test-')));
  const executable = join(dir, 'synthetic-cli');
  const marker = join(dir, 'executed');
  const previousSecret = process.env.ORQST_SYNTHETIC_SECRET;
  process.env.ORQST_SYNTHETIC_SECRET = 'synthetic';
  try {
    const source = join(dir, 'fixture.c');
    await writeFile(
      source,
      `#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) { FILE *f = fopen(${JSON.stringify(marker)}, "w"); if (!f) return 1; fprintf(f, "%s\\n%s\\n%s\\n", argc == 2 ? argv[1] : "invalid", getenv("HOME") ? getenv("HOME") : "", getenv("ORQST_SYNTHETIC_SECRET") ? "present" : "absent"); fclose(f); puts("codex-cli 0.162.1"); return 0; }
`,
    );
    execFileSync('cc', [source, '-o', executable]);
    let valid = false;
    const verifier = {
      async verify() {
        return { valid, teamId: '2DC432GLL2', identifier: 'codex' };
      },
    };
    await assert.rejects(probeSignedCliVersion(verifier, 'codex', 'tui', executable), /signature/);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
    valid = true;
    const result = await probeSignedCliVersion(verifier, 'codex', 'tui', executable);
    assert.equal(result.version, '0.162.1');
    const [argument, home, secret] = (await readFile(marker, 'utf8')).trimEnd().split('\n');
    assert.equal(argument, '--version');
    assert.ok(home);
    assert.notEqual(home, process.env.HOME);
    assert.equal(secret, 'absent');
    await assert.rejects(readFile(join(home, 'missing')), { code: 'ENOENT' });
  } finally {
    if (previousSecret === undefined) delete process.env.ORQST_SYNTHETIC_SECRET;
    else process.env.ORQST_SYNTHETIC_SECRET = previousSecret;
    await rm(dir, { recursive: true, force: true });
  }
});

test('a synthetic descendant holding the version pipes cannot defeat the timeout', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'orqst-probe-timeout-')));
  const executable = join(dir, 'synthetic-cli');
  const source = join(dir, 'fixture.c');
  try {
    await writeFile(
      source,
      '#include <unistd.h>\nint main(void) { if (fork() == 0) { sleep(10); return 0; } sleep(10); return 0; }\n',
    );
    execFileSync('cc', [source, '-o', executable]);
    const verifier = {
      async verify() {
        return { valid: true, teamId: '2DC432GLL2', identifier: 'codex' };
      },
    };
    const start = Date.now();
    await assert.rejects(probeSignedCliVersion(verifier, 'codex', 'tui', executable), /timed out/);
    assert.ok(Date.now() - start < 8000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
