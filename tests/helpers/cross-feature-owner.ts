// SYNTHETIC owner-fence processes against disposable SQLite only.
import { Store } from '@orqst/database';
import { fixture } from './cross-feature-fixture.js';

if (process.argv[2] === 'owner') {
  const f = fixture();
  process.send?.({ type: 'ready', dir: f.dir, epoch: f.journal.epoch });
  process.once('message', () => {
    f.close();
    process.disconnect();
  });
} else {
  process.send?.({ type: 'ready' });
  process.once('message', (raw: { file: string; epoch: string }) => {
    const store = new Store(raw.file);
    let error: string | undefined;
    try {
      store.communicationJournal(raw.epoch, { recover: false });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      store.close();
    }
    process.send?.({ type: 'result', error }, () => process.disconnect());
  });
}
