import { randomUUID, sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { terminalNativeReplySchema, terminalNativeRequestSchema } from '@orqst/protocol';
import {
  TerminalAuthority,
  terminalChallengeBytes,
} from '../../../packages/core/src/terminal/authority.js';
import type { InteractiveMcpSession } from '../../../packages/core/src/terminal/interactive-mcp.js';
import {
  TerminalNativeBroker,
  type TerminalNativeSupervisor,
} from '../../../packages/core/src/terminal/native-broker.js';

const slot = z.number().int().min(0).max(7);
export const tauriTerminalMessageSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('request'),
    id: z.uuid(),
    slot,
    request: z.unknown(),
    focused: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('revoke'), slot }),
  z.strictObject({ kind: z.literal('close'), slot }),
  z.strictObject({ kind: z.literal('confirm'), id: z.uuid(), accepted: z.boolean() }),
  z.strictObject({ kind: z.literal('authorizeMcp'), id: z.uuid(), slot, focused: z.boolean() }),
]);

export interface TauriTerminalMcp {
  prepareMcp(): Promise<unknown>;
  authorizeMcp(proof: unknown): Promise<unknown>;
  closeSlot(slot: number): Promise<unknown>;
}

/** Private parent pipe only. This service is never mounted on the observer HTTP/WS API. */
export class TauriTerminalService {
  private readonly panes;
  private readonly confirmations = new Map<
    string,
    { slot: number; resolve(value: boolean): void }
  >();
  private closed = false;
  private generation = 0;
  private mcpBusy = false;

  constructor(
    supervisors: TerminalNativeSupervisor[],
    private readonly keys: { publicKey: KeyObject; privateKey: KeyObject },
    private readonly send: (value: object) => void,
    private readonly translate: (key: string) => string,
    private readonly mcp?: TauriTerminalMcp,
  ) {
    this.panes = supervisors.map((supervisor, slot) => {
      const document = Object.freeze({ slot });
      const state = { focused: false, busy: false, closed: false };
      const authority = new TerminalAuthority(
        new Map([['desktop-managed', keys.publicKey]]),
        Date.now,
      );
      const broker = new TerminalNativeBroker(
        authority,
        supervisor,
        'desktop-managed',
        keys.privateKey,
        document,
        {
          current: (target, focus) =>
            !this.closed && !state.closed && target === document && (!focus || state.focused),
          confirm: async (_document, details) => {
            const detail = JSON.stringify(details, null, 2).replace(
              /\p{Cf}/gu,
              (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`,
            );
            if (detail.length > 4096 || (details.paste?.length ?? 0) > 1024) return false;
            const id = randomUUID();
            return new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => finish(false), 30_000);
              const finish = (accepted: boolean) => {
                clearTimeout(timer);
                this.confirmations.delete(id);
                resolve(accepted && state.focused && !state.closed && !this.closed);
              };
              this.confirmations.set(id, { slot, resolve: finish });
              this.send({
                kind: 'confirm',
                id,
                slot,
                title: translate('terminalNative.title'),
                message: translate(`terminalNative.${details.operation}`),
                detail,
                cancel: translate('terminalNative.cancel'),
                approve: translate('terminalNative.confirm'),
              });
            });
          },
        },
      );
      return { document, state, broker };
    });
  }

  async receive(raw: unknown): Promise<void> {
    const parsed = tauriTerminalMessageSchema.safeParse(raw);
    if (this.closed || !parsed.success) throw new Error('Invalid private terminal message');
    const message = parsed.data;
    if (message.kind === 'confirm') {
      this.confirmations.get(message.id)?.resolve(message.accepted);
      return;
    }
    const pane = this.panes[message.slot];
    if (!pane) throw new Error('Unknown native terminal document');
    if (message.kind === 'revoke' || message.kind === 'close') {
      this.generation++;
      pane.state.focused = false;
      for (const pending of [...this.confirmations.values()])
        if (pending.slot === message.slot || this.mcpBusy) pending.resolve(false);
      if (message.kind === 'close') {
        pane.state.closed = true;
        pane.broker.close();
        // Reload/destruction invalidates the shared MCP grant, never just the view's lease.
        await this.mcp?.closeSlot(message.slot);
      } else pane.broker.revokeInput();
      return;
    }
    if (message.kind === 'authorizeMcp') {
      await this.authorizeMcp(message);
      return;
    }
    const request = terminalNativeRequestSchema.safeParse(message.request);
    if (!request.success) {
      this.send({ kind: 'reply', id: message.id, value: { status: 'denied' } });
      return;
    }
    if (pane.state.busy || this.mcpBusy) {
      this.send({ kind: 'reply', id: message.id, value: { status: 'busy' } });
      return;
    }
    pane.state.busy = true;
    pane.state.focused = message.focused;
    try {
      const reply = await pane.broker.dispatch(pane.document, request.data);
      const value = terminalNativeReplySchema.safeParse({
        ...reply,
        ...(reply.status === 'ok' && reply.output
          ? { output: { ...reply.output, bytes: Array.from(reply.output.bytes) } }
          : {}),
      });
      this.send({
        kind: 'reply',
        id: message.id,
        value: value.success ? value.data : { status: 'denied' },
      });
    } finally {
      pane.state.busy = false;
    }
  }

  /** Only the native menu can enter here; the public terminal request schema has no MCP action. */
  private async authorizeMcp(message: {
    id: string;
    slot: number;
    focused: boolean;
  }): Promise<void> {
    const reply = (status: 'ok' | 'denied' | 'busy' | 'cancelled') =>
      this.send({ kind: 'reply', id: message.id, value: { status } });
    if (!this.mcp || this.panes.length !== 2 || this.panes.some((p) => p.state.closed))
      return reply('denied');
    if (this.mcpBusy || this.panes.some((p) => p.state.busy)) return reply('busy');
    if (!message.focused) return reply('denied');
    this.mcpBusy = true;
    const generation = this.generation;
    const current = () => !this.closed && this.generation === generation;
    try {
      const prepared = (await this.mcp.prepareMcp()) as ReturnType<
        InteractiveMcpSession['prepare']
      >;
      const detail = JSON.stringify(prepared.grant, null, 2).replace(
        /\p{Cf}/gu,
        (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`,
      );
      if (!current() || detail.length > 4096) return reply('denied');
      const accepted = await new Promise<boolean>((resolve) => {
        const id = randomUUID();
        const timer = setTimeout(() => finish(false), 30_000);
        const finish = (accepted: boolean) => {
          clearTimeout(timer);
          this.confirmations.delete(id);
          resolve(accepted);
        };
        this.confirmations.set(id, { slot: message.slot, resolve: finish });
        this.send({
          kind: 'confirm',
          id,
          requestId: message.id,
          slot: message.slot,
          title: this.translate('managedTerminal.mcpAuthorize'),
          message: this.translate('managedTerminal.mcpConfirm'),
          detail,
          cancel: this.translate('terminalNative.cancel'),
          approve: this.translate('terminalNative.confirm'),
        });
      });
      if (!accepted || !current()) return reply('cancelled');
      if (Date.now() >= Math.min(prepared.challenge.expiresAt, prepared.grant.expiresAt))
        return reply('denied');
      await this.mcp.authorizeMcp({
        challengeId: prepared.challenge.challengeId,
        signature: sign(
          null,
          terminalChallengeBytes(prepared.challenge),
          this.keys.privateKey,
        ).toString('base64url'),
      });
      reply(current() ? 'ok' : 'denied');
    } catch {
      reply('denied');
    } finally {
      this.mcpBusy = false;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of [...this.confirmations.values()]) pending.resolve(false);
    for (const pane of this.panes) pane.broker.close();
  }
}
