/** Reviewed release contracts. Equal bounds intentionally admit only the cited releases. */
export type CliContractProvider = 'codex' | 'claude' | 'opencode';
export type CliContractMode = 'tui' | 'mcp';

export interface CliContract {
  readonly provider: CliContractProvider;
  readonly mode: CliContractMode;
  readonly minimum: string;
  readonly maximum: string;
  readonly revision: string;
}

const contracts: readonly CliContract[] = Object.freeze(
  [
    {
      provider: 'codex',
      mode: 'tui',
      minimum: '0.162.1',
      maximum: '0.162.1',
      revision: 'codex-tui-0.162.1',
    },
    {
      provider: 'codex',
      mode: 'mcp',
      minimum: '0.162.1',
      maximum: '0.162.1',
      revision: 'codex-mcp-0.162.1',
    },
    {
      provider: 'claude',
      mode: 'tui',
      minimum: '2.1.318',
      maximum: '2.1.318',
      revision: 'claude-tui-2.1.318',
    },
    {
      provider: 'claude',
      mode: 'mcp',
      minimum: '2.1.178',
      maximum: '2.1.178',
      revision: 'claude-mcp-2.1.178',
    },
    {
      provider: 'claude',
      mode: 'mcp',
      minimum: '2.1.318',
      maximum: '2.1.318',
      revision: 'claude-mcp-2.1.318',
    },
    {
      provider: 'opencode',
      mode: 'tui',
      minimum: '2.2.5',
      maximum: '2.2.5',
      revision: 'opencode-tui-2.2.5',
    },
    {
      provider: 'opencode',
      mode: 'mcp',
      minimum: '2.2.5',
      maximum: '2.2.5',
      revision: 'opencode-mcp-2.2.5',
    },
  ].map((contract) => Object.freeze(contract as CliContract)),
);

function semver(value: string): readonly bigint[] | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match || value.length > 64) return;
  return [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)];
}

function compare(left: readonly bigint[], right: readonly bigint[]): number {
  for (let index = 0; index < 3; index++) {
    if (left[index]! < right[index]!) return -1;
    if (left[index]! > right[index]!) return 1;
  }
  return 0;
}

/** Unrecognized, prerelease and unreviewed versions are rejected. */
export function findCliContract(
  provider: CliContractProvider,
  mode: CliContractMode,
  version: string,
): CliContract | undefined {
  const parsed = semver(version);
  if (!parsed) return;
  return contracts.find(
    (contract) =>
      contract.provider === provider &&
      contract.mode === mode &&
      compare(parsed, semver(contract.minimum)!) >= 0 &&
      compare(parsed, semver(contract.maximum)!) <= 0,
  );
}

/** Only exact reviewed releases can be disclosed as a finite authorization set. */
export function exactCliContracts(
  provider: CliContractProvider,
  mode: CliContractMode,
): readonly Readonly<{ version: string; contractRevision: string }>[] {
  const selected = contracts.filter(
    (contract) => contract.provider === provider && contract.mode === mode,
  );
  if (selected.some((contract) => contract.minimum !== contract.maximum))
    throw new Error('CLI contract set is not finite');
  return Object.freeze(
    selected.map((contract) =>
      Object.freeze({
        version: contract.minimum,
        contractRevision: contract.revision,
      }),
    ),
  );
}
