import { z } from 'zod';
import { prepareTerminalCreation, type TerminalCreationInput } from './terminal-creation.js';
import { TerminalSelection } from './terminal-selection.js';

export const tauriPreparationSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    provider: z.enum(['codex', 'claude']),
    count: z.number().int().min(1).max(8),
  }),
  z.strictObject({
    action: z.literal('review'),
    files: z.array(z.string().min(1).max(2048)).min(1).max(8),
  }),
]);

export interface TauriPreparationPorts {
  current(): boolean;
  choose(directory: boolean): Promise<string | undefined>;
  confirm(key: 'create' | 'acknowledge' | 'open', detail: string): Promise<boolean>;
  /** Native latch precedes the first possible write, including an uncertain partial write. */
  commit(): Promise<boolean>;
}

/** Reuse the existing passive provisioning and full selection review; never start a CLI. */
export async function prepareTauriTerminals(
  raw: unknown,
  context: Pick<TerminalCreationInput, 'parent' | 'home' | 'node' | 'environment'>,
  ports: TauriPreparationPorts,
  now: () => number = Date.now,
): Promise<{ status: 'cancelled' | 'prepared' | 'open'; files: string[] }> {
  const request = tauriPreparationSchema.parse(raw);
  const expires = now() + 300_000;
  const current = () => now() < expires && ports.current();
  let files: string[];
  if (!current()) return { status: 'cancelled', files: [] };
  if (request.action === 'create') {
    const executable = await ports.choose(false);
    if (!current() || !executable) return { status: 'cancelled', files: [] };
    const project = await ports.choose(true);
    if (!current() || !project) return { status: 'cancelled', files: [] };
    const plan = prepareTerminalCreation({
      ...context,
      provider: request.provider,
      count: request.count,
      limit: 8,
      executable,
      project,
      mcp: false,
    });
    const reviewExpires = now() + 60_000;
    const reviewed = () => current() && now() < reviewExpires;
    for (const page of plan.pages) {
      if (!reviewed() || !(await ports.confirm('create', page)) || !reviewed())
        return { status: 'cancelled', files: [] };
    }
    if (!(await ports.confirm('acknowledge', '')) || !reviewed())
      return { status: 'cancelled', files: [] };
    if (!(await ports.commit()) || !reviewed()) return { status: 'cancelled', files: [] };
    files = plan.provision(reviewed);
  } else files = request.files;

  // Selection is a second transaction. Cancelling it preserves the completed manifests.
  const selection = new TerminalSelection(now, 8);
  const result = await selection.review({
    current,
    choose: async () => files,
    confirm: (page) => ports.confirm('open', page),
  });
  return result === 'reviewed'
    ? { status: 'open', files: selection.take() }
    : { status: 'prepared', files };
}
