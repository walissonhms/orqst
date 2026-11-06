// SYNTHETIC golden fixture (no user data): run the pair RPC Feature/team/layout kinds of
// packages/core/src/terminal/host.ts against a temporary private preferences Store.
// Usage: tsx features.ts <ops.json> <userData dir>  -> prints JSON {results, featureIds, cf}.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FeaturePermissionRevisionConflict } from '../../../../../packages/database/src/index.js';
import { stableId } from '../../../../../packages/shared/src/index.js';
import { terminalPairRPCSchema } from '../../../../../packages/core/src/terminal/rpc.js';
import { featureConfigurationDatabase } from '../../../../../packages/core/src/terminal/feature-configuration.js';
import { terminalTeamDatabase } from '../../../../../packages/core/src/terminal/team-database.js';
import { terminalLayoutDatabase } from '../../../../../packages/core/src/terminal/layout-database.js';

const [opsFile, userData] = process.argv.slice(2) as [string, string];
const fixture = JSON.parse(readFileSync(opsFile, 'utf8')) as {
  terminalIds: string[];
  project: string;
  ops: Record<string, unknown>[];
};
let clock = 1_000;
Date.now = () => (clock += 7);
const workspaceId = stableId('workspace', fixture.project);
const teamWorkspace = createHash('sha256').update(fixture.project).digest('hex');
const ids = fixture.terminalIds;
const features = () => featureConfigurationDatabase(userData, workspaceId);
const featureIds: string[] = [];
const resolve = (value: unknown): unknown =>
  typeof value === 'string' && /^\$F\d+$/.test(value)
    ? (featureIds[Number(value.slice(2)) - 1] ?? '00000000-0000-4000-8000-00000000dead')
    : Array.isArray(value)
      ? value.map(resolve)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]))
        : value;

const results = fixture.ops.map((raw) => {
  try {
    const request = terminalPairRPCSchema.parse(resolve(raw));
    let value: unknown;
    switch (request.kind) {
      case 'featureViewRead':
        value = features().readView();
        break;
      case 'featureViewSave':
        value = features().saveView(request.input);
        break;
      case 'featureList':
        value = features().list();
        break;
      case 'featureRead':
        value = features().read(request.featureId);
        break;
      case 'featureCreate':
        value = features().create(request.input);
        featureIds.push((value as { featureId: string }).featureId);
        break;
      case 'featureUpdate':
        value = features().update(request.featureId, request.input);
        break;
      case 'featureAssign': {
        const terminal = ids[request.slot];
        if (!terminal) throw new Error('Unknown reviewed terminal');
        value = features().assignTerminal(request.featureId, terminal, request.expectedRevision);
        break;
      }
      case 'featurePermissionsRead':
        value = features().readPermissions(request.featureId);
        break;
      case 'featurePermissionsSave':
        try {
          value = {
            status: 'ok',
            permissions: features().savePermissions(
              request.featureId,
              request.actorId,
              request.input,
            ),
          };
        } catch (error) {
          if (!(error instanceof FeaturePermissionRevisionConflict)) throw error;
          value = { status: 'conflict' };
        }
        break;
      case 'featureTeamRead':
        value = features().readTeam(request.featureId);
        break;
      case 'featureTeamSave':
        value = features().saveTeam(request.featureId, request.input);
        break;
      case 'featureLayoutRead':
        value = features().readLayout(request.featureId);
        break;
      case 'featureLayoutSave':
        value = features().saveLayout(request.featureId, request.record);
        break;
      case 'teamRead':
        value = terminalTeamDatabase(userData, ids, teamWorkspace).read();
        break;
      case 'teamSave':
        value = terminalTeamDatabase(userData, ids, teamWorkspace).save(request.input);
        break;
      case 'layoutRead':
        value = terminalLayoutDatabase(userData, ids).read();
        break;
      case 'layoutSave':
        terminalLayoutDatabase(userData, ids).save(request.record);
        break;
      case 'layoutImport':
        value = terminalLayoutDatabase(userData, ids).import(request.record);
        break;
      default:
        throw new Error('Unexpected kind');
    }
    return value === undefined ? 'ok:undefined' : `ok:${JSON.stringify(value)}`;
  } catch {
    return 'error';
  }
});

// Unicode Cf ranges as Node's ICU sees them (checks the Rust display-name table).
const cf: [number, number][] = [];
for (let code = 0; code <= 0x10ffff; code++) {
  if (code >= 0xd800 && code <= 0xdfff) continue;
  if (!/\p{Cf}/u.test(String.fromCodePoint(code))) continue;
  const last = cf.at(-1);
  if (last && last[1] === code - 1) last[1] = code;
  else cf.push([code, code]);
}
console.log(JSON.stringify({ results, featureIds, cf, workspaceId, teamWorkspace }));
