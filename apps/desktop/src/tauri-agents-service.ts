import { randomUUID, sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { managedAgentsReplySchema, managedAgentsRequestSchema } from '@orqst/protocol';
import type { DesktopManagedAgents } from '../../../packages/core/src/managed-codex/desktop.js';
import {
  terminalChallengeBytes,
  type TerminalChallenge,
} from '../../../packages/core/src/terminal/authority.js';

export const tauriAgentsMessageSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('request'),
    id: z.uuid(),
    request: z.unknown(),
    focused: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('revoke') }),
  z.strictObject({ kind: z.literal('confirm'), id: z.uuid(), accepted: z.boolean() }),
]);

/** Private native pipe over the existing structured host. Never an observer API. */
export class TauriAgentsService {
  private closed = false;
  private busy = false;
  private generation = 0;
  private pending?: { id: string; resolve(accepted: boolean): void };

  constructor(
    private readonly core: {
      call(operation: Record<string, unknown>): Promise<unknown>;
      close(): void;
    },
    private readonly privateKey: KeyObject,
    private readonly send: (message: object) => void,
    private readonly translate: (key: string) => string,
  ) {}

  async receive(raw: unknown): Promise<void> {
    const message = tauriAgentsMessageSchema.parse(raw);
    if (this.closed) throw new Error('Native agents document closed');
    if (message.kind === 'revoke') {
      this.generation++;
      this.pending?.resolve(false);
      return;
    }
    if (message.kind === 'confirm') {
      if (message.id === this.pending?.id) this.pending.resolve(message.accepted);
      return;
    }
    const reply = (value: unknown) =>
      this.send({ kind: 'reply', id: message.id, value: managedAgentsReplySchema.parse(value) });
    const parsed = managedAgentsRequestSchema.safeParse(message.request);
    if (!parsed.success) return reply({ status: 'denied' });
    const request = parsed.data;
    const generation = this.generation;
    const current = () => !this.closed && this.generation === generation;
    const snapshot = async () => ({
      status: 'ok',
      snapshot: await this.core.call({ operation: 'snapshot' }),
    });
    if (request.action === 'snapshot') {
      try {
        const value = await snapshot();
        reply(current() ? value : { status: 'denied' });
      } catch {
        reply({ status: 'unavailable' });
      }
      return;
    }
    if (this.busy) return reply({ status: 'busy' });
    if (!message.focused) return reply({ status: 'focus_required' });
    this.busy = true;
    try {
      let challenge: TerminalChallenge;
      let details: unknown;
      let task: ReturnType<DesktopManagedAgents['prepareTask']> | undefined;
      let routing: ReturnType<DesktopManagedAgents['prepareRouting']> | undefined;
      if (request.action === 'start') {
        const prepared = (await this.core.call({
          operation: 'prepareStart',
          slot: request.slot,
          model: request.model,
        })) as ReturnType<DesktopManagedAgents['prepareStart']>;
        challenge = prepared.challenge;
        details = prepared.manifest;
      } else if (request.action === 'routing') {
        routing = (await this.core.call({
          operation: 'prepareRouting',
          slot: request.slot,
          update: request.update,
        })) as ReturnType<DesktopManagedAgents['prepareRouting']>;
        challenge = routing.challenge;
        details = routing.plan;
      } else if (request.action === 'delegate') {
        task = (await this.core.call({
          operation: 'prepareTask',
          text: request.text,
          task: request.task,
          sourceSlot: request.sourceSlot,
        })) as ReturnType<DesktopManagedAgents['prepareTask']>;
        challenge = task.challenge;
        details = task.plan;
      } else if (request.action === 'retire') {
        const prepared = (await this.core.call({ operation: 'prepareRetire' })) as ReturnType<
          DesktopManagedAgents['prepareRetire']
        >;
        challenge = prepared.challenge;
        details = prepared.evidence;
      } else {
        challenge = (await this.core.call({
          operation: 'prepareStop',
          slot: request.slot,
        })) as TerminalChallenge;
        details = { signal: 'SIGTERM', challenge };
      }
      const detail = JSON.stringify(details, null, 2).replace(
        /\p{Cf}/gu,
        (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`,
      );
      if (!current() || detail.length > 4096) return reply({ status: 'denied' });
      const accepted = await new Promise<boolean>((resolve) => {
        const id = randomUUID();
        const timer = setTimeout(() => finish(false), 30_000);
        const finish = (accepted: boolean) => {
          clearTimeout(timer);
          this.pending = undefined;
          resolve(accepted);
        };
        this.pending = { id, resolve: finish };
        this.send({
          kind: 'confirm',
          id,
          requestId: message.id,
          title: this.translate('managedAgents.title'),
          message: this.translate(`managedAgents.confirm_${request.action}`),
          detail,
          cancel: this.translate('terminalNative.cancel'),
          approve: this.translate('terminalNative.confirm'),
        });
      });
      if (!accepted || !current()) return reply({ status: 'cancelled' });
      if (Date.now() >= challenge.expiresAt) return reply({ status: 'denied' });
      const proof = {
        challengeId: challenge.challengeId,
        signature: sign(null, terminalChallengeBytes(challenge), this.privateKey).toString(
          'base64url',
        ),
      };
      if (request.action === 'start')
        await this.core.call({ operation: 'launch', slot: request.slot, proof });
      else if (request.action === 'routing')
        await this.core.call({ operation: 'applyRouting', changeId: routing!.changeId, proof });
      else if (request.action === 'delegate')
        await this.core.call({
          operation: 'runTask',
          taskId: task!.plan.taskId,
          correlationId: task!.plan.correlationId,
          proof,
        });
      else if (request.action === 'stop')
        await this.core.call({ operation: 'stop', slot: request.slot, proof });
      else await this.core.call({ operation: 'retire', proof });
      const value = await snapshot();
      reply(current() ? value : { status: 'denied' });
    } catch {
      reply({ status: 'unavailable' });
    } finally {
      this.busy = false;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    this.pending?.resolve(false);
    this.core.close();
  }
}
