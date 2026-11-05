import type { FeatureNativeSnapshot } from '@orqst/protocol';

export type PermissionOperation = 'delegate' | 'execute' | 'view';
export interface PermissionTerminal {
  terminalId: string;
  label: string;
  provider: string;
}
export interface PermissionRule {
  sourceTerminalId: string;
  targetTerminalId: string;
  operations: PermissionOperation[];
}

const OPERATIONS: PermissionOperation[] = ['delegate', 'execute', 'view'];

/** Terminals assigned to the active Feature, labelled T-001 by their slot. */
export function permissionTerminals(
  snapshot: FeatureNativeSnapshot | undefined,
  featureId: string | null,
): PermissionTerminal[] {
  const feature = snapshot?.features.find((entry) => entry.featureId === featureId);
  if (!snapshot || !feature) return [];
  return feature.terminalIds.flatMap((terminalId) => {
    const slot = snapshot.slots.find((entry) => entry.terminalId === terminalId);
    return slot
      ? [
          {
            terminalId,
            label: `T-${String(slot.slot + 1).padStart(3, '0')}`,
            provider: slot.provider,
          },
        ]
      : [];
  });
}

export function permissionRules(configuration: unknown): PermissionRule[] {
  const rules = (configuration as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule) => {
    if (!rule || typeof rule !== 'object') return [];
    const source = (rule as { sourceTerminalId?: unknown }).sourceTerminalId;
    const target = (rule as { targetTerminalId?: unknown }).targetTerminalId;
    const ops = (rule as { operations?: unknown }).operations;
    if (typeof source !== 'string' || typeof target !== 'string' || !Array.isArray(ops)) return [];
    const operations = ops.filter((op): op is PermissionOperation =>
      OPERATIONS.includes(op as PermissionOperation),
    );
    return [{ sourceTerminalId: source, targetTerminalId: target, operations }];
  });
}

/** Self-send, duplicate pairs and delegate cycles are refused before proposing. */
export function permissionProblems(rules: PermissionRule[]): string[] {
  const problems: string[] = [];
  const pairs = new Set<string>();
  const graph = new Map<string, string[]>();
  for (const rule of rules) {
    const key = `${rule.sourceTerminalId}:${rule.targetTerminalId}`;
    if (rule.sourceTerminalId === rule.targetTerminalId) problems.push('self');
    if (pairs.has(key)) problems.push('duplicate');
    if (new Set(rule.operations).size !== rule.operations.length) problems.push('duplicate');
    pairs.add(key);
    if (rule.operations.includes('delegate')) {
      graph.set(rule.sourceTerminalId, [
        ...(graph.get(rule.sourceTerminalId) ?? []),
        rule.targetTerminalId,
      ]);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((graph.get(id) ?? []).some(cycle)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if ([...graph.keys()].some(cycle)) problems.push('cycle');
  return [...new Set(problems)];
}

export function toggleOperation(
  rules: PermissionRule[],
  source: string,
  target: string,
  operation: PermissionOperation,
): PermissionRule[] {
  const existing = rules.find(
    (rule) => rule.sourceTerminalId === source && rule.targetTerminalId === target,
  );
  if (!existing)
    return [
      ...rules,
      { sourceTerminalId: source, targetTerminalId: target, operations: [operation] },
    ];
  const operations = existing.operations.includes(operation)
    ? existing.operations.filter((entry) => entry !== operation)
    : [...existing.operations, operation];
  return operations.length
    ? rules.map((rule) => (rule === existing ? { ...rule, operations } : rule))
    : rules.filter((rule) => rule !== existing);
}

export function permissionConfiguration(rules: PermissionRule[]) {
  return {
    schemaVersion: 1 as const,
    rules: rules.map((rule) => ({ ...rule, operations: [...rule.operations] })),
  };
}
