import { z } from 'zod';
import { terminalStateSchema } from '@orqst/protocol';

export const ownedShutdownInventorySchema = z.strictObject({
  epoch: z.uuid(),
  attempts: z
    .array(
      z.strictObject({
        slot: z.number().int().min(0).max(7),
        instanceId: z.uuid(),
        epoch: z.uuid(),
        state: terminalStateSchema,
        exit: z
          .strictObject({
            exitCode: z.number().int().safe(),
            signal: z.number().int().safe().optional(),
          })
          .optional(),
      }),
    )
    .max(1024),
});
export type OwnedShutdownInventory = z.infer<typeof ownedShutdownInventorySchema>;
export type OwnedShutdownAttempt = OwnedShutdownInventory['attempts'][number];
export interface OwnedShutdownResult {
  status: 'ready' | 'uncertain' | 'exited_retirement_unavailable';
  reason?: 'timeout' | 'transport' | 'retirement_unavailable';
  evidence?: OwnedShutdownInventory;
  uncertain: Array<{
    slot: number;
    instanceId: string;
    reason: 'timeout' | 'ownership_lost' | 'transport' | 'retirement_unavailable';
  }>;
}

/** Bounded release transaction over existing owned Core handles. No process discovery or recovery. */
export class OwnedTerminalShutdown {
  private inFlight?: Promise<OwnedShutdownResult>;
  private readonly signalled = new Set<string>();
  private epoch?: string;

  constructor(
    private readonly ports: {
      /** Native Quit/CloseRequested pipe only, never a renderer or terminal-focus claim. */
      current(): boolean;
      inventory(): Promise<unknown>;
      owns(attempt: OwnedShutdownAttempt): boolean;
      /** SIGTERM only. Check stillCurrent after asynchronous preparation, before signing/effect. */
      stop(attempt: OwnedShutdownAttempt, stillCurrent: () => boolean): Promise<void>;
      prepareRetirement(): Promise<unknown>;
      /** Only a durable Core-owned pending marker can permit exit without retirement. */
      preserveExit?(): Promise<unknown>;
      now?(): number;
      wait?(ms: number): Promise<void>;
    },
    private readonly timeoutMs = 5000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
      throw new Error('Invalid owned shutdown deadline');
  }

  /** Concurrent Quit intents share one wait; later retries only recheck receipts, never signal twice. */
  run(): Promise<OwnedShutdownResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.perform().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async perform(): Promise<OwnedShutdownResult> {
    const now = this.ports.now ?? Date.now;
    const deadline = now() + this.timeoutMs;
    let active = true;
    let evidence: OwnedShutdownInventory | undefined;
    const errors = new Map<string, OwnedShutdownResult['uncertain'][number]>();
    const current = () => active && this.ports.current() && now() < deadline;
    const bounded = async <T>(operation: Promise<T>): Promise<T> => {
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error('Shutdown deadline');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          operation,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Shutdown deadline')), remaining);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    const uncertain = (
      attempt: OwnedShutdownAttempt,
      reason: OwnedShutdownResult['uncertain'][number]['reason'],
    ) =>
      errors.set(attempt.instanceId, {
        slot: attempt.slot,
        instanceId: attempt.instanceId,
        reason,
      });
    try {
      while (current()) {
        evidence = ownedShutdownInventorySchema.parse(await bounded(this.ports.inventory()));
        this.epoch ??= evidence.epoch;
        if (
          evidence.epoch !== this.epoch ||
          evidence.attempts.some((a) => a.epoch !== this.epoch || !this.ports.owns(a))
        )
          throw new Error('Owned shutdown source changed');
        errors.clear();
        let waiting = false;
        for (const attempt of evidence.attempts) {
          if (['prepared', 'start_failed'].includes(attempt.state)) continue;
          if (attempt.state === 'exited' && attempt.exit) continue;
          if (!['starting', 'running'].includes(attempt.state)) {
            uncertain(attempt, 'ownership_lost');
            continue;
          }
          waiting = true;
          if (attempt.state === 'starting') continue;
          if (!this.signalled.has(attempt.instanceId)) {
            if (!current()) {
              uncertain(attempt, 'timeout');
              continue;
            }
            // Latch before a possibly consumed proof. No automatic retry or SIGKILL escalation.
            this.signalled.add(attempt.instanceId);
            try {
              await bounded(this.ports.stop(attempt, current));
            } catch {
              uncertain(attempt, 'transport');
            }
          }
        }
        if (!waiting && !errors.size) {
          try {
            const prepared = z
              .object({ evidence: ownedShutdownInventorySchema })
              .parse(await bounded(this.ports.prepareRetirement()));
            if (!current() || JSON.stringify(prepared.evidence) !== JSON.stringify(evidence))
              throw new Error('Retirement evidence changed');
            return { status: 'ready', evidence, uncertain: [] };
          } catch {
            if (this.ports.preserveExit && current()) {
              try {
                const preserved = z
                  .object({
                    status: z.literal('leader_exited_retirement_pending'),
                    evidence: ownedShutdownInventorySchema,
                  })
                  .parse(await bounded(this.ports.preserveExit()));
                if (!current() || JSON.stringify(preserved.evidence) !== JSON.stringify(evidence))
                  throw new Error('Preserved exit evidence changed');
                return {
                  status: 'exited_retirement_unavailable',
                  reason: 'retirement_unavailable',
                  evidence,
                  uncertain: [],
                };
              } catch {
                /* Never exit on an unconfirmed durable pending marker. */
              }
            }
            for (const attempt of evidence.attempts) uncertain(attempt, 'retirement_unavailable');
            return { status: 'uncertain', evidence, uncertain: [...errors.values()] };
          }
        }
        if (errors.size) return { status: 'uncertain', evidence, uncertain: [...errors.values()] };
        await bounded(
          (this.ports.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
            Math.min(50, Math.max(1, deadline - now())),
          ),
        );
      }
      for (const attempt of evidence?.attempts ?? [])
        if (
          !['prepared', 'start_failed'].includes(attempt.state) &&
          !(attempt.state === 'exited' && attempt.exit)
        )
          uncertain(attempt, 'timeout');
    } catch {
      for (const attempt of evidence?.attempts ?? [])
        if (
          !['prepared', 'start_failed'].includes(attempt.state) &&
          !(attempt.state === 'exited' && attempt.exit)
        )
          uncertain(attempt, now() >= deadline ? 'timeout' : 'transport');
    } finally {
      active = false;
    }
    // Missing evidence is uncertainty too, even if no safe instance identity can be listed.
    return {
      status: 'uncertain',
      reason: now() >= deadline ? 'timeout' : 'transport',
      ...(evidence ? { evidence } : {}),
      uncertain: [...errors.values()],
    };
  }
}
