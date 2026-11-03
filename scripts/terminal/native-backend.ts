// Synthetic transport backend only, never a Codex/Claude/OpenCode launcher.
import { fork } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { terminalDigest } from '../../packages/core/src/terminal/authority.js';
import type {
  TerminalBackend,
  TerminalProfile,
} from '../../packages/core/src/terminal/supervisor.js';
import { syntheticEventSchema } from './native-channel.js';

export function syntheticNativeBackend(node: string, root: string, profile: TerminalProfile) {
  const expected = JSON.stringify(profile);
  const fixture = join(root, 'synthetic-fixture.mjs');
  const fixtureHash = terminalDigest(readFileSync(fixture));
  const host = join(root, 'host.cjs');
  const hostHash = terminalDigest(readFileSync(host));
  const backend: TerminalBackend = {
    validate: (value) =>
      JSON.stringify(value) === expected &&
      terminalDigest(readFileSync(node)) === profile.executableSha256 &&
      terminalDigest(readFileSync(fixture)) === fixtureHash &&
      terminalDigest(readFileSync(host)) === hostHash,
    start: (_profile, events) => {
      // Native addon stays in a pinned Node host, never loaded by Electron's different ABI.
      const child = fork(host, ['--authorize-synthetic-pty'], {
        execPath: node,
        execArgv: [],
        cwd: root,
        env: { HOME: root, TMPDIR: root, LANG: 'C', LC_ALL: 'C' },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      let confirmedExit = false;
      let disposed = false;
      const message = (raw: unknown) => {
        if (disposed) return;
        const parsed = syntheticEventSchema.safeParse(raw);
        if (!parsed.success) return events.lost();
        const event = parsed.data;
        if (event.type === 'started') events.started();
        if (event.type === 'data') events.data(event.text);
        if (event.type === 'exit') {
          confirmedExit = true;
          events.exit(event.exitCode, event.signal);
        }
      };
      const lost = () => {
        if (!disposed && !confirmedExit) events.lost();
      };
      child.on('message', message);
      child.on('error', lost);
      child.on('exit', lost);
      child.on('disconnect', lost);
      const send = (value: object) => {
        if (disposed || !child.connected || !child.send(value, (error) => error && lost())) {
          events.lost();
          throw new Error('Synthetic transport unavailable');
        }
      };
      return {
        write: (text) => send({ action: 'write', text }),
        resize: (columns, rows) => send({ action: 'resize', columns, rows }),
        signal: (signal) => send({ action: 'signal', signal }),
        dispose: () => {
          disposed = true;
          child.off('message', message);
          child.off('disconnect', lost);
          child.off('exit', lost);
          // Retain an inert error listener until child exit; never signal on disposal.
          if (child.connected) child.disconnect();
        },
      };
    },
  };
  return backend;
}
