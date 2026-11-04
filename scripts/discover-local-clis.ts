// Developer preflight, outside application startup. No provider process or state access.
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import {
  discoverLocalClis,
  localCliIntegrationPlan,
} from '../packages/core/src/terminal/local-cli.js';

parseArgs({ options: {}, allowPositionals: false });
const discovery = discoverLocalClis(process.env.PATH ?? '', homedir());
console.log(
  JSON.stringify(
    {
      version: 1,
      scope: 'passive-local-cli-preflight',
      providers: discovery.map((value) => ({
        ...value,
        integration: localCliIntegrationPlan(value),
      })),
    },
    null,
    2,
  ),
);
