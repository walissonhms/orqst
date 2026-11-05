// Disposable admission marker test process; never accesses an application directory.
import {
  closeSync,
  constants,
  fsyncSync,
  openSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const [directory, role] = process.argv.slice(2);
const marker = join(directory, 'active-pair.json');
const archived = join(directory, 'released-original.json');
function syncDirectory() {
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
process.on('message', (message) => {
  if (role === 'owner' && message === 'reserve') {
    writeFileSync(marker, 'SYNTHETIC-OWNER\n', { flag: 'wx', mode: 0o600, flush: true });
    syncDirectory();
    process.send('reserved');
  } else if (role === 'owner' && message === 'verify') {
    process.send('verifying'); // Marker remains present until the parent permits release.
  } else if (role === 'owner' && message === 'release') {
    renameSync(marker, archived); // Fresh synthetic destination; native RENAME_EXCL has its own test.
    syncDirectory();
    process.send('released');
  } else if (role === 'contender' && message === 'claim') {
    try {
      writeFileSync(marker, 'SYNTHETIC-CONTENDER\n', { flag: 'wx', mode: 0o600, flush: true });
      syncDirectory();
      process.send('claimed');
    } catch (error) {
      process.send(error.code === 'EEXIST' ? 'reserved' : 'error');
    }
  } else if (message === 'stop') process.disconnect();
});
