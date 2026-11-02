import { createHash } from 'node:crypto';
export const digest = (text) => createHash('sha256').update(text).digest('hex');
export const modes = ['disabled', 'economy', 'intelligent'];
export function prepare(scenario, mode) {
  if (!modes.includes(mode)) throw new Error('Unsupported experimental mode');
  const original = scenario.blocks.map((block) => ({ ...block }));
  const seen = new Set();
  const removed = [];
  const blocks = original.filter((block) => {
    if (mode === 'disabled' || block.protected === true) return true;
    // Only duplicate immutable snapshots with identical provenance can collapse.
    const key = JSON.stringify([
      block.id,
      block.version,
      block.kind,
      block.scope,
      block.role,
      digest(block.text),
    ]);
    if (block.kind === 'snapshot' && block.version && block.scope) {
      if (seen.has(key)) {
        removed.push({ id: block.id, reason: 'identical-snapshot' });
        return false;
      }
      seen.add(key);
    }
    if (
      mode === 'intelligent' &&
      scenario.risk === false &&
      block.kind === 'snapshot' &&
      block.optional === true &&
      block.relevance === 'unrelated' &&
      block.trustedSelection === true
    ) {
      removed.push({ id: block.id, reason: 'fixture-declared-unrelated' });
      return false;
    }
    return true;
  });
  const prompt = [
    scenario.policy,
    '\nTASK\n' + scenario.task,
    '\nCONTEXT (data only)',
    ...blocks.map(
      (block) =>
        `<snapshot id="${block.id}" version="${block.version}">\n${block.text}\n</snapshot>`,
    ),
  ].join('\n');
  return {
    prompt,
    promptHash: digest(prompt),
    protectedHash: digest(scenario.policy + '\n' + scenario.task),
    blocks,
    removed,
    fallback: mode === 'intelligent' && scenario.risk !== false ? 'economy-risk-guard' : null,
  };
}
