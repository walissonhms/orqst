// SYNTHETIC child process for cross-Feature serialization tests.
import { readFileSync } from 'node:fs';
import { fixture } from './cross-feature-fixture.js';
import { featureConfigurationDatabase } from '../../packages/core/src/terminal/feature-configuration.js';
import { CrossFeatureCommunication } from '../../packages/core/src/communication/cross-feature-communication.js';

const mode = process.argv[2];
if (mode === 'writer') {
  const [dir, featureId] = process.argv.slice(3);
  const config = featureConfigurationDatabase(dir!, 'synthetic');
  config.saveCrossFeaturePermissions(featureId!, 'SYNTHETIC_actor', 1, {
    schemaVersion: 1,
    rules: [],
  });
  process.send?.({ type: 'written' }, () => process.exit(0));
} else {
  const f = fixture();
  f.save('source', 0, f.policy('outbound'));
  f.save('target', 0, f.policy('inbound'));
  const fifo = process.argv[3]!;
  const wait = () => {
    readFileSync(fifo);
  };
  let barrierPending = mode !== 'claim';
  const snapshot = (...args: Parameters<typeof f.config.crossFeatureSnapshot>) => {
    if ((mode === 'before' || mode === 'claim') && barrierPending) {
      barrierPending = false;
      process.send?.({ type: 'barrier' });
      wait();
    }
    const value = f.config.crossFeatureSnapshot(...args);
    if (mode === 'after' && barrierPending) {
      barrierPending = false;
      process.send?.({ type: 'barrier' });
      wait();
    }
    if (mode === 'crash-before') process.exit(19);
    return value;
  };
  const service = new CrossFeatureCommunication(f.journal, snapshot, f.authority);
  process.send?.({ type: 'ready', dir: f.dir, target: f.target.featureId });
  process.once('message', () => {
    try {
      if (mode === 'claim') {
        service.admit(f.grant, f.request, 'SYNTHETIC-proof');
        barrierPending = true;
        const claim = service.claim(f.request.messageId);
        process.send?.({ type: 'result', admitted: true, claimed: Boolean(claim) }, () =>
          process.exit(0),
        );
        return;
      }
      service.admit(f.grant, f.request, 'SYNTHETIC-proof');
      if (mode === 'crash-after') process.exit(19);
      const claim = mode === 'after' ? service.claim(f.request.messageId) : undefined;
      process.send?.({ type: 'result', admitted: true, claimed: Boolean(claim) }, () =>
        process.exit(0),
      );
    } catch {
      process.send?.({ type: 'result', admitted: false }, () => process.exit(0));
    }
  });
}
