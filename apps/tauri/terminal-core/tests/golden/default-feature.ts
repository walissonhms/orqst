// SYNTHETIC golden fixture: verify defaultFeatureId, assignToOpenOrDefault and layout preservation.
import { defaultFeatureId } from '../../../../../packages/protocol/src/index.js';
import { featureConfigurationDatabase } from '../../../../../packages/core/src/terminal/feature-configuration.js';

const userData = process.argv[2]!;
let clock = 5_000;
Date.now = () => (clock += 11);
const workspaceId = 'synthetic-ws-default';
const t1 = '00000000-0000-4000-8000-0000000000a1';
const t2 = '00000000-0000-4000-8000-0000000000b1';
const t3 = '00000000-0000-4000-8000-0000000000c1';
const db = featureConfigurationDatabase(userData, workspaceId);
const first = db.assignToOpenOrDefault(null, [t1], 'Geral');
db.saveLayout(first.feature.featureId, {
  version: 1,
  order: [t1],
  shown: [t1],
  active: t1,
  maximized: t1,
  axis: 'columns',
  columns: 1,
  percent: 50,
  names: [],
});
const moved = db.assignTerminal(first.feature.featureId, t2, first.feature.revision);
const reused = db.assignToOpenOrDefault(null, [t3], 'General');
console.log(
  JSON.stringify({
    defaultId: defaultFeatureId(workspaceId),
    first,
    moved,
    reused,
    layout: db.readLayout(first.feature.featureId),
  }),
);
