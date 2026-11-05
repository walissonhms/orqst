import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findCliContract,
  exactCliContracts,
  type CliContractMode,
  type CliContractProvider,
} from '../packages/core/src/terminal/cli-contract.js';

test('each reviewed CLI contract has bounded inclusive release versions', () => {
  const cases: [CliContractProvider, CliContractMode, string, string, string][] = [
    ['codex', 'tui', '0.162.1', '0.162.0', '0.162.2'],
    ['codex', 'mcp', '0.162.1', '0.162.0', '0.162.2'],
    ['claude', 'tui', '2.1.318', '2.1.317', '2.1.319'],
    ['claude', 'mcp', '2.1.178', '2.1.177', '2.1.179'],
    ['claude', 'mcp', '2.1.318', '2.1.317', '2.1.319'],
    ['opencode', 'tui', '2.2.5', '2.2.4', '2.2.6'],
    ['opencode', 'mcp', '2.2.5', '2.2.4', '2.2.6'],
  ];
  for (const [provider, mode, reviewed, before, after] of cases) {
    assert.ok(findCliContract(provider, mode, reviewed));
    assert.equal(findCliContract(provider, mode, before), undefined);
    assert.equal(findCliContract(provider, mode, after), undefined);
  }
  assert.equal(findCliContract('claude', 'tui', '2.1.178'), undefined);
});

test('disclosure enumerates immutable exact contracts from the launch source', () => {
  const contracts = exactCliContracts('claude', 'mcp');
  assert.deepEqual(contracts, [
    { version: '2.1.178', contractRevision: 'claude-mcp-2.1.178' },
    { version: '2.1.318', contractRevision: 'claude-mcp-2.1.318' },
  ]);
  assert.ok(Object.isFrozen(contracts));
  for (const entry of contracts) {
    assert.ok(Object.isFrozen(entry));
    assert.equal(findCliContract('claude', 'mcp', entry.version)?.revision, entry.contractRevision);
  }
});

test('versions with prerelease, metadata or noncanonical format are refused', () => {
  for (const version of [
    '0.162.1-rc.1',
    '0.162.1+build',
    'v0.162.1',
    '0.162.1\n',
    '00.162.1',
    '0.162',
    'unknown',
    ' 0.162.1',
    '9'.repeat(100) + '.1.1',
  ]) {
    assert.equal(findCliContract('codex', 'tui', version), undefined, version);
  }
});
