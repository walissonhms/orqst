import { offlineRecoveryHelperArguments } from './offline-recovery-arguments.js';
import {
  AdministrativeReviewPipe,
  ADMIN_FRAME_BYTES,
  ADMIN_SESSION_BYTES,
} from './offline-recovery-wire.js';
import { administrativeBlockedOutcome, TauriOfflineRecovery } from './tauri-offline-recovery.js';

process.umask(0o077);
async function main() {
  if (
    process.platform !== 'darwin' ||
    process.arch !== 'arm64' ||
    process.getuid?.() === 0 ||
    !/^v24\./.test(process.version) ||
    ![3, 5].includes(process.argv.length)
  )
    throw new Error('Unsupported native administrative helper');
  const { parent, historicalEvidenceFile } = offlineRecoveryHelperArguments(process.argv.slice(2));
  let sent = 0,
    received = 0;
  const pipe = new AdministrativeReviewPipe((value) => send(value));
  const recovery = new TauriOfflineRecovery(parent, pipe, {}, historicalEvidenceFile);
  const deadline = setTimeout(close, 300_000);
  function close() {
    clearTimeout(deadline);
    pipe.close();
    process.stdin.destroy();
  }
  function send(value: object) {
    if (!pipe.current()) return;
    const line = JSON.stringify(value) + '\n';
    sent += Buffer.byteLength(line);
    if (
      Buffer.byteLength(line) > ADMIN_FRAME_BYTES ||
      sent > ADMIN_SESSION_BYTES ||
      process.stdout.writableLength > ADMIN_FRAME_BYTES
    )
      return close();
    process.stdout.write(line);
  }
  let buffer = Buffer.alloc(0);
  let busy = false;
  process.stdin.on('data', (chunk: Buffer) => {
    received += chunk.length;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 16 * 1024 || received > ADMIN_SESSION_BYTES) return close();
    const end = buffer.indexOf(10);
    if (end < 0) return;
    try {
      const value: unknown = JSON.parse(buffer.subarray(0, end).toString('utf8'));
      buffer = buffer.subarray(end + 1);
      if (buffer.length) return close(); // No pipelining or old ACK queued for a later phase.
      if (typeof value !== 'object' || value === null) return close();
      if ('kind' in value && value.kind === 'answer') return pipe.answer(value);
      if ('kind' in value && value.kind === 'authorized') return pipe.authorized(value);
      if (busy) return close();
      busy = true;
      void recovery
        .receive(value)
        .then(
          (outcome) =>
            send({
              kind: 'complete',
              session: pipe.session,
              id: 'id' in value ? value.id : null,
              status: 'done',
              outcome,
            }),
          (error: unknown) =>
            send({
              kind: 'complete',
              session: pipe.session,
              id: 'id' in value ? value.id : null,
              ...administrativeBlockedOutcome(error),
            }),
        )
        .finally(() => {
          busy = false;
        });
    } catch {
      close();
    }
  });
  process.stdin.on('end', close);
  process.stdin.on('error', close);
  process.stdout.on('error', close);
  process.stdin.resume();
  send({ kind: 'ready', version: 2, session: pipe.session });
}
void main().catch(() => {
  process.exitCode = 1;
});
