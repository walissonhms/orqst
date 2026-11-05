import { OwnedTerminalShutdown } from '../../../packages/core/src/terminal/owned-shutdown.js';
import type { TerminalCliPolicyStore } from '../../../packages/core/src/terminal/cli-authorization.js';
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
import {
  TauriTerminalRetirement,
  type TauriTerminalRetirementCore,
  type OwnedTerminalRetirementEvidence,
} from './tauri-terminal-retirement.js';

const slot = z.number().int().min(0).max(7);
export const tauriTerminalMessageSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('request'),
    id: z.uuid(),
    slot,
    request: z.unknown(),
    focused: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('retire'), id: z.uuid(), slot, focused: z.boolean() }),
  // Native Quit/CloseRequested private pipe only. Neither action is in terminalNativeRequestSchema.
  z.strictObject({ kind: z.literal('shutdownOwned'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('retireOwned'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('closePreservedOwned'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('revoke'), slot }),
  z.strictObject({ kind: z.literal('suspend-input'), slot }),
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
  private metadataBusy = false;
  private readonly retirement?: TauriTerminalRetirement;
  private readonly ownedShutdown?: OwnedTerminalShutdown;
  private shutdownFence = false;
  private shutdownReady = false;
  private shutdownPreserved = false;

  /** Read-only shutdown fence for the visual adapter; never grants authority. */
  fenced(): boolean {
    return this.shutdownFence;
  }

  constructor(
    supervisors: TerminalNativeSupervisor[],
    private readonly keys: { publicKey: KeyObject; privateKey: KeyObject },
    private readonly send: (value: object) => void,
    private readonly translate: (key: string) => string,
    private readonly mcp?: TauriTerminalMcp,
    private readonly core?: TauriTerminalRetirementCore,
    private readonly cliPolicy?: TerminalCliPolicyStore,
  ) {
    if (core) this.retirement = new TauriTerminalRetirement(core, keys.privateKey);
    this.panes = supervisors.map((supervisor, slot) => this.pane(supervisor, slot));
    if (core?.beginOwnedShutdown)
      this.ownedShutdown = new OwnedTerminalShutdown({
        current: () => !this.closed && this.shutdownFence,
        inventory: () => core.beginOwnedShutdown!(),
        owns: (attempt) => core.epoch === attempt.epoch && this.panes[attempt.slot] !== undefined,
        stop: async (attempt, current) => {
          const supervisor = this.panes[attempt.slot]?.supervisor;
          if (!supervisor || !current()) throw new Error('Shutdown ownership unavailable');
          const challenge = await supervisor.requestStop(
            'desktop-managed',
            attempt.instanceId,
            'SIGTERM',
          );
          if (
            !current() ||
            challenge.operation !== 'stop' ||
            challenge.target !== attempt.instanceId ||
            challenge.epoch !== attempt.epoch ||
            challenge.clientId !== 'desktop-managed' ||
            Date.now() >= challenge.expiresAt
          )
            throw new Error('Shutdown stop proof is stale');
          await supervisor.stop(attempt.instanceId, 'SIGTERM', {
            challengeId: challenge.challengeId,
            signature: sign(null, terminalChallengeBytes(challenge), this.keys.privateKey).toString(
              'base64url',
            ),
          });
        },
        prepareRetirement: () => core.prepareRetire(),
        ...(core.preserveOwnedShutdown
          ? { preserveExit: () => core.preserveOwnedShutdown!() }
          : {}),
      });
  }

  private pane(supervisor: TerminalNativeSupervisor, slot: number) {
    const document = Object.freeze({ slot });
    const state: {
      focused: boolean;
      busy: boolean;
      reviewing: boolean;
      closed: boolean;
      instanceId?: string;
    } = { focused: false, busy: false, reviewing: false, closed: false };
    const authority = new TerminalAuthority(
      new Map([['desktop-managed', this.keys.publicKey]]),
      Date.now,
    );
    const broker = new TerminalNativeBroker(
      authority,
      supervisor,
      'desktop-managed',
      this.keys.privateKey,
      document,
      {
        current: (target, focus) =>
          !this.closed && !state.closed && target === document && (!focus || state.focused),
        ...(this.cliPolicy
          ? {
              cliAuthorization: {
                authorizeCli: async (
                  _document: object,
                  profile: Parameters<TerminalCliPolicyStore['current']>[0],
                ) => {
                  if (!state.focused || state.closed || this.closed) return 'blocked' as const;
                  return this.cliPolicy!.authorizeCli(profile, () =>
                    this.confirm(
                      slot,
                      this.translate('terminalNative.cliScope'),
                      JSON.stringify(
                        {
                          executable: profile.executable,
                          sha256: profile.executableSha256,
                          version: profile.executableVersion,
                          scope: 'owned-local-terminal-v1',
                        },
                        null,
                        2,
                      ).replace(/\p{Cf}/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`),
                      'terminalNative.authorizeCli',
                    ),
                  );
                },
                current: (
                  _document: object,
                  profile: Parameters<TerminalCliPolicyStore['current']>[0],
                ) => this.cliPolicy!.current(profile),
                epoch: (profile: Parameters<TerminalCliPolicyStore['current']>[0]) =>
                  this.cliPolicy!.epoch(profile),
              },
            }
          : {}),
        confirm: async (_document, details) => {
          const detail = JSON.stringify(details, null, 2).replace(
            /\p{Cf}/gu,
            (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`,
          );
          if (detail.length > 4096 || (details.paste?.length ?? 0) > 1024) return false;
          return this.confirm(
            slot,
            this.translate(`terminalNative.${details.operation}`),
            detail,
            details.operation === 'open' ? 'studio.tauri.open' : 'terminalNative.confirm',
          );
        },
      },
    );
    return { document, state, broker, supervisor };
  }

  /** Confirmed native enrollment only; previous document/broker/grants remain the same objects. */
  append(slot: number, supervisor: TerminalNativeSupervisor): void {
    if (this.closed || !this.metadataBusy || slot !== this.panes.length || slot >= 8)
      throw new Error('Invalid native terminal append');
    this.panes.push(this.pane(supervisor, slot));
  }

  /** Bilateral exclusion with the existing reviews; no new execution permission. */
  beginMetadata(): boolean {
    if (
      this.closed ||
      this.shutdownFence ||
      this.metadataBusy ||
      this.mcpBusy ||
      this.retirement?.busy ||
      this.retirement?.fenced ||
      this.confirmations.size ||
      this.panes.some((pane) => pane.state.reviewing)
    )
      return false;
    this.metadataBusy = true;
    return true;
  }

  endMetadata(): void {
    this.metadataBusy = false;
  }

  async receive(raw: unknown): Promise<void> {
    const parsed = tauriTerminalMessageSchema.safeParse(raw);
    if (this.closed || !parsed.success) throw new Error('Invalid private terminal message');
    const message = parsed.data;
    if (message.kind === 'confirm') {
      this.confirmations.get(message.id)?.resolve(message.accepted);
      return;
    }
    if (
      message.kind === 'shutdownOwned' ||
      message.kind === 'retireOwned' ||
      message.kind === 'closePreservedOwned'
    ) {
      await this.nativeOwnedShutdown(message);
      return;
    }
    const pane = this.panes[message.slot];
    if (!pane) throw new Error('Unknown native terminal document');
    if (message.kind === 'suspend-input') {
      // An owned native sheet keeps its exact review, but never its keyboard lease.
      pane.broker.suspendInput();
      return;
    }
    if (message.kind === 'revoke' || message.kind === 'close') {
      this.generation++;
      pane.state.focused = false;
      for (const pending of [...this.confirmations.values()])
        if (pending.slot === message.slot || this.mcpBusy || this.retirement?.busy)
          pending.resolve(false);
      if (message.kind === 'close') {
        pane.state.closed = true;
        pane.broker.close();
        // Reload/destruction invalidates the shared MCP grant, never just the view's lease.
        await this.mcp?.closeSlot(message.slot);
      } else pane.broker.revokeInput();
      return;
    }
    const passive =
      message.kind === 'request' &&
      (() => {
        const request = terminalNativeRequestSchema.safeParse(message.request);
        return request.success && ['read', 'snapshot', 'resize'].includes(request.data.action);
      })();
    if (
      (this.metadataBusy && !passive) ||
      (this.shutdownFence && !passive && message.kind !== 'retire')
    ) {
      this.send({
        kind: message.kind === 'retire' ? 'retirement' : 'reply',
        id: message.id,
        value: { status: 'busy' },
        status: 'denied',
        fenced: false,
      });
      return;
    }
    if (message.kind === 'retire') {
      if (!this.retirement || this.mcpBusy || this.panes.some((p) => p.state.busy)) {
        this.send({
          kind: 'retirement',
          id: message.id,
          status: 'denied',
          fenced: this.retirement?.fenced ?? false,
        });
        return;
      }
      // Block every pane before the asynchronous preparation, including polling/read requests.
      if (this.retirement.busy || this.retirement.fenced) {
        this.send({
          kind: 'retirement',
          id: message.id,
          status: 'denied',
          fenced: this.retirement?.fenced ?? false,
        });
        return;
      }
      for (const p of this.panes) p.broker.revokeInput();
      pane.state.focused = message.focused;
      const generation = this.generation;
      const status = await this.retirement.run({
        current: () =>
          !this.closed &&
          !pane.state.closed &&
          pane.state.focused &&
          this.generation === generation,
        confirm: (detail) =>
          this.confirm(message.slot, this.translate('managedTerminal.retireConfirm'), detail),
        ...(this.cliPolicy
          ? {
              authorizeOwnedRetirement: (evidence: OwnedTerminalRetirementEvidence) =>
                evidence.attempts.length > 0 &&
                evidence.epoch === this.core?.epoch &&
                evidence.attempts.every((attempt) => this.panes[attempt.slot] !== undefined),
            }
          : {}),
        closeBrokers: () => {
          for (const p of this.panes) p.broker.close();
        },
      });
      this.send({ kind: 'retirement', id: message.id, status, fenced: this.retirement.fenced });
      return;
    }
    if (this.retirement?.busy || this.retirement?.fenced) {
      this.send({ kind: 'reply', id: message.id, value: { status: 'denied' } });
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
    pane.state.reviewing = !['read', 'snapshot', 'resize'].includes(request.data.action);
    pane.state.focused = message.focused;
    try {
      const reply = await pane.broker.dispatch(pane.document, request.data);
      if (reply.status === 'ok' && ['start', 'open'].includes(request.data.action))
        pane.state.instanceId = reply.instanceId;
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
      pane.state.reviewing = false;
    }
  }

  /** Passive display projection: only instances created by this document's broker. */
  async canvasEvidence(
    identities: ReadonlyArray<{ slot: number; terminalId: string }>,
    epoch: string,
  ) {
    const results = await Promise.all(
      identities.map(async ({ slot, terminalId }) => {
        const pane = this.panes[slot];
        const id = pane?.state.instanceId;
        const unknown = { slot, terminalId, state: 'unknown' as const };
        if (!pane || pane.state.closed || !id || this.closed) return unknown;
        try {
          const snapshot = await pane.supervisor.snapshot(id);
          if (
            this.closed ||
            pane.state.closed ||
            pane.state.instanceId !== id ||
            snapshot.instanceId !== id ||
            snapshot.epoch !== epoch ||
            !snapshot.lifecycle
          )
            return unknown;
          const { startedAt, exitedAt } = snapshot.lifecycle;
          if (startedAt > Date.now() || (exitedAt !== undefined && exitedAt > Date.now()))
            return unknown;
          if (snapshot.state === 'running' && exitedAt === undefined)
            return { slot, terminalId, state: 'running' as const, startedAt };
          if (snapshot.state === 'exited' && exitedAt !== undefined)
            return { slot, terminalId, state: 'exited' as const, startedAt, exitedAt };
        } catch {
          // A lost or inaccessible Core never becomes a confirmed state.
        }
        return unknown;
      }),
    );
    return { observedAt: Date.now(), entries: results };
  }

  /** Native main-window Quit only. No terminal focus assertion or renderer action is accepted. */
  private async nativeOwnedShutdown(message: {
    kind: 'shutdownOwned' | 'retireOwned' | 'closePreservedOwned';
    id: string;
  }): Promise<void> {
    if (message.kind === 'closePreservedOwned') {
      let status: 'closed' | 'denied' = 'denied';
      if (this.shutdownPreserved && this.shutdownFence && this.core) {
        try {
          await this.core.closeAndWait();
          status = 'closed';
        } catch {
          /* Keep unknown honest. */
        }
      }
      this.send({ kind: 'owned-shutdown-closed', id: message.id, status });
      return;
    }
    if (message.kind === 'retireOwned') {
      if (!this.retirement || !this.shutdownReady || !this.shutdownFence) {
        this.send({ kind: 'retirement', id: message.id, status: 'denied', fenced: false });
        return;
      }
      const status = await this.retirement.run({
        current: () => !this.closed && this.shutdownReady && this.shutdownFence,
        authorizeOwnedRetirement: (evidence) =>
          evidence.attempts.length > 0 &&
          evidence.epoch === this.core?.epoch &&
          evidence.attempts.every((attempt) => this.panes[attempt.slot] !== undefined),
        closeBrokers: () => {
          for (const pane of this.panes) pane.broker.close();
        },
      });
      this.send({ kind: 'retirement', id: message.id, status, fenced: this.retirement.fenced });
      return;
    }
    const refuse = (status: 'refused_prefence' | 'fenced') =>
      this.send({ kind: 'owned-shutdown', id: message.id, status, uncertain: [] });
    // Retirement may already have consumed a proof, even before this route ran.
    if (this.retirement?.busy || this.retirement?.fenced) return refuse('fenced');
    if (!this.ownedShutdown) return refuse(this.shutdownFence ? 'fenced' : 'refused_prefence');
    if (
      this.metadataBusy ||
      this.mcpBusy ||
      this.confirmations.size ||
      this.panes.some((p) => p.state.busy)
    )
      return refuse(this.shutdownFence ? 'fenced' : 'refused_prefence');
    this.shutdownFence = true;
    for (const pane of this.panes) pane.broker.revokeInput();
    const result = await this.ownedShutdown.run();
    this.shutdownReady = result.status === 'ready';
    this.shutdownPreserved = result.status === 'exited_retirement_unavailable';
    this.send({ kind: 'owned-shutdown', id: message.id, ...result });
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

  private confirm(
    slot: number,
    message: string,
    detail: string,
    approve = 'terminalNative.confirm',
  ): Promise<boolean> {
    const pane = this.panes[slot];
    if (!pane || this.closed || pane.state.closed || !pane.state.focused)
      return Promise.resolve(false);
    const id = randomUUID();
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), 30_000);
      const finish = (accepted: boolean) => {
        clearTimeout(timer);
        this.confirmations.delete(id);
        resolve(accepted && pane.state.focused && !pane.state.closed && !this.closed);
      };
      this.confirmations.set(id, { slot, resolve: finish });
      this.send({
        kind: 'confirm',
        id,
        slot,
        title: this.translate('terminalNative.title'),
        message,
        detail,
        cancel: this.translate('terminalNative.cancel'),
        approve: this.translate(approve),
      });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of [...this.confirmations.values()]) pending.resolve(false);
    for (const pane of this.panes) pane.broker.close();
  }
}
