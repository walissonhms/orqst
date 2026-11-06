import { z } from 'zod';
import { preferencesSchema, terminalIdentitySchema } from '@orqst/protocol';

const entrySchema = terminalIdentitySchema
  .extend({
    turnId: z.uuid().optional(),
    agentState: z.enum(['running', 'waiting_for_user', 'completed', 'failed', 'unknown']),
  })
  .refine((entry) => entry.agentState === 'unknown' || entry.turnId !== undefined);

/** In-memory projection only: no provider, notification or renderer access. */
export class OwnedTurnMonitor {
  private previous = new Map<string, z.infer<typeof entrySchema>>();
  private seen = new Set<string>();

  accept(raw: unknown, rawPreferences: unknown) {
    const parsedEntries = z.array(entrySchema).max(8).safeParse(raw);
    const parsedPreferences = preferencesSchema.safeParse(rawPreferences);
    if (!parsedEntries.success || !parsedPreferences.success) {
      this.disconnect();
      throw new Error('Invalid owned turn evidence or preferences');
    }
    const entries = parsedEntries.data;
    if (new Set(entries.map((entry) => entry.terminalId)).size !== entries.length) {
      this.disconnect();
      throw new Error('Duplicate owned terminal evidence');
    }
    const preferences = parsedPreferences.data;
    const alerts: Array<{
      terminalId: string;
      turnId: string;
      category: 'completed' | 'failed' | 'waiting_for_user';
      silent: boolean;
    }> = [];
    const next = new Map<string, z.infer<typeof entrySchema>>();
    for (const entry of entries) {
      const previous = this.previous.get(entry.terminalId);
      next.set(entry.terminalId, entry);
      if (
        !entry.turnId ||
        !previous ||
        previous.turnId !== entry.turnId ||
        previous.agentState !== 'running' ||
        !['completed', 'failed', 'waiting_for_user'].includes(entry.agentState)
      )
        continue;
      const key = `${entry.terminalId}:${entry.turnId}:${entry.agentState}`;
      if (this.seen.has(key) || this.seen.size >= 128) continue;
      // Consume transitions even when disabled, so changing a preference cannot replay them.
      this.seen.add(key);
      const category = entry.agentState;
      if (category !== 'completed' && category !== 'failed' && category !== 'waiting_for_user')
        continue;
      if (preferences[category === 'waiting_for_user' ? 'intervention' : category])
        alerts.push({
          terminalId: entry.terminalId,
          turnId: entry.turnId,
          category,
          silent: !preferences.sound,
        });
    }
    this.previous = next;
    return alerts;
  }

  disconnect() {
    // Unknown/missing observations cannot bridge a transition or replay after reconnect.
    this.previous.clear();
  }
}
