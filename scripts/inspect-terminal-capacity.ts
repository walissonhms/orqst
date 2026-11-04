// Explicit metadata-only capacity inspection. Never opens a journal owner or releases capacity.
import { parseArgs } from 'node:util';
import { inspectTerminalCapacity } from './terminal/capacity.js';

try {
  const { values } = parseArgs({
    options: { journal: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  if (!values.journal) throw new Error('Missing journal');
  const report = inspectTerminalCapacity(values.journal);
  console.log(JSON.stringify(report));
  if (report.ownerClaimed || report.reservations.length > 0) process.exitCode = 1;
} catch {
  console.error(
    'Capacity inspection unavailable; provide --journal /absolute/path/terminal.sqlite.',
  );
  process.exitCode = 1;
}
