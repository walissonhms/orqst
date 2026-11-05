import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import test from 'node:test';
import { electronKernelQuery } from '../apps/desktop/src/electron-kernel-query.js';

const binary = process.env.ORQST_TEST_KERNEL_QUERY;
test(
  'native query preserves live identity and denies recycled start',
  {
    skip: process.platform !== 'darwin' || !binary,
  },
  async () => {
    const query = electronKernelQuery(realpathSync(binary!));
    const self = await query.identity(process.pid);
    assert.equal(self.pid, process.pid);
    assert.equal(await query.exists(self), true);
    assert.equal(await query.exists({ ...self, startSec: self.startSec - 1 }), false);
  },
);
