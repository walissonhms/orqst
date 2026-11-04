import { randomUUID, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { terminalNativeReplySchema, terminalNativeRequestSchema } from '@orqst/protocol';
import { TerminalAuthority } from '../../../packages/core/src/terminal/authority.js';
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
]);

/** Private parent pipe only. This service is never mounted on the observer HTTP/WS API. */
export class TauriTerminalService {
  private readonly panes;
  private readonly confirmations = new Map<
    string,
    { slot: number; resolve(value: boolean): void }
  >();
  private closed = false;

  constructor(
    supervisors: TerminalNativeSupervisor[],
    keys: { publicKey: KeyObject; privateKey: KeyObject },
    private readonly send: (value: object) => void,
    translate: (key: string) => string,
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
      pane.state.focused = false;
      for (const pending of [...this.confirmations.values()])
        if (pending.slot === message.slot) pending.resolve(false);
      if (message.kind === 'close') {
        pane.state.closed = true;
        pane.broker.close();
      } else pane.broker.revokeInput();
      return;
    }
    const request = terminalNativeRequestSchema.safeParse(message.request);
    if (!request.success) {
      this.send({ kind: 'reply', id: message.id, value: { status: 'denied' } });
      return;
    }
    if (pane.state.busy) {
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

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of [...this.confirmations.values()]) pending.resolve(false);
    for (const pane of this.panes) pane.broker.close();
  }
}
