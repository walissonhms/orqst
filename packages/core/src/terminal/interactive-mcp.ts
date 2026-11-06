import { z } from 'zod';
import type { TerminalAuthority } from './authority.js';
import { McpTaskBroker, type McpRole, type McpTaskEvidence } from './mcp-task.js';
import { openMcpInstanceSockets } from './mcp-socket.js';
import type { TerminalBackend } from './supervisor.js';

// A pair is disposable; every grant still requires a separate native confirmation.
const MAX_GRANTS_PER_SESSION = 16;

/** One disposable pair, bound at actual dispatch. Socket authentication alone grants no task. */
export class InteractiveMcpSession {
  private instances = new Map<number, string>();
  private broker?: McpTaskBroker;
  private candidate?: McpTaskBroker;
  private closed = false;
  private opened = false;
  private grantGeneration = 0;
  private transport?: Awaited<ReturnType<typeof openMcpInstanceSockets>>;

  constructor(
    private authority: TerminalAuthority,
    private workspaceId: string,
    private owned: (slot: number, instanceId: string) => boolean,
    private readonly evidence?: {
      bind(source: string, target: string): ((event: McpTaskEvidence) => void) | undefined;
    },
  ) {}

  async open(parent = '/tmp') {
    if (this.opened || this.closed) throw new Error('MCP session already opened');
    this.opened = true;
    this.transport = await openMcpInstanceSockets(
      {
        snapshot: () =>
          (this.broker ?? this.candidate)?.snapshot() ?? {
            state: this.closed ? 'unknown' : 'ungranted',
          },
        grantGeneration: () => this.grantGeneration,
        call: (role: McpRole, raw: unknown) => {
          if (this.closed || !this.broker) return Promise.reject(new Error('MCP ungranted'));
          const broker = this.broker;
          return broker.call(role, raw);
        },
        close: () => this.invalidate(),
      },
      parent,
    );
    if (this.closed) {
      await this.transport.close();
      throw new Error('MCP session closed during setup');
    }
    return this.transport.endpoints;
  }

  wrap(slot: number, backend: TerminalBackend): TerminalBackend {
    if (slot !== 0 && slot !== 1) throw new Error('Invalid MCP slot');
    return {
      validate: (profile) => backend.validate(profile),
      start: (profile, events, identity) => {
        if (
          this.closed ||
          !this.transport ||
          this.instances.has(slot) ||
          !identity ||
          profile.projectId !== this.workspaceId ||
          identity.epoch !== this.authority.epoch ||
          [...this.instances.values()].includes(identity.instanceId)
        )
          throw new Error('MCP instance binding denied');
        this.instances.set(slot, z.uuid().parse(identity.instanceId));
        try {
          const handle = backend.start(
            profile,
            {
              ...events,
              lost: () => {
                this.invalidate();
                events.lost();
              },
              exit: (code, signal) => {
                this.invalidate();
                events.exit(code, signal);
              },
            },
            identity,
          );
          return {
            ...handle,
            dispose: () => {
              this.invalidate();
              handle.dispose();
            },
          };
        } catch (error) {
          this.invalidate();
          throw error;
        }
      },
    };
  }

  prepare() {
    if (this.closed || !this.transport || !this.ownedForGrant())
      throw new Error('Two owned running MCP instances required');
    if (this.grantGeneration >= MAX_GRANTS_PER_SESSION) throw new Error('MCP grant limit reached');
    if (!this.transport.idle()) throw new Error('MCP call in flight');
    const state = this.broker?.snapshot().state;
    if (state && !['ungranted', 'completed', 'unknown'].includes(state))
      throw new Error('Delegation unavailable');
    this.candidate?.close();
    this.candidate = new McpTaskBroker(
      this.authority,
      {
        sourceInstanceId: this.instances.get(0)!,
        targetInstanceId: this.instances.get(1)!,
        workspaceId: this.workspaceId,
      },
      () => !this.closed && this.ownedForGrant(),
      120_000,
      this.evidence?.bind(this.instances.get(0)!, this.instances.get(1)!),
    );
    return this.candidate.prepare();
  }

  authorize(proof: unknown) {
    if (this.closed || !this.ownedForGrant() || !this.candidate || !this.transport?.idle())
      throw new Error('MCP unavailable');
    this.candidate.authorize(proof);
    this.broker?.close();
    this.broker = this.candidate;
    this.candidate = undefined;
    this.grantGeneration++;
  }

  snapshot() {
    return (
      (this.broker ?? this.candidate)?.snapshot() ?? {
        state: this.closed ? 'unknown' : 'ungranted',
      }
    );
  }

  private allOwned() {
    return (
      this.instances.size === 2 && [...this.instances].every(([slot, id]) => this.owned(slot, id))
    );
  }

  private ownedForGrant() {
    const owned = this.allOwned();
    if (!owned && this.instances.size === 2) this.invalidate();
    return owned;
  }

  invalidate() {
    this.closed = true;
    this.broker?.close();
    this.candidate?.close();
  }

  async close() {
    this.invalidate();
    await this.transport?.close();
  }
}
