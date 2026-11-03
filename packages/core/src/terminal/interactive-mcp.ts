import { z } from 'zod';
import type { TerminalAuthority } from './authority.js';
import { McpTaskBroker, type McpRole } from './mcp-task.js';
import { openMcpInstanceSockets } from './mcp-socket.js';
import type { TerminalBackend } from './supervisor.js';

/** One disposable pair, bound at actual dispatch. Socket authentication alone grants no task. */
export class InteractiveMcpSession {
  private instances = new Map<number, string>();
  private broker?: McpTaskBroker;
  private closed = false;
  private opened = false;
  private transport?: Awaited<ReturnType<typeof openMcpInstanceSockets>>;

  constructor(
    private authority: TerminalAuthority,
    private workspaceId: string,
    private owned: (slot: number, instanceId: string) => boolean,
  ) {}

  async open(parent = '/tmp') {
    if (this.opened || this.closed) throw new Error('MCP session already opened');
    this.opened = true;
    this.transport = await openMcpInstanceSockets(
      {
        snapshot: () =>
          this.broker?.snapshot() ?? {
            state: this.closed ? 'unknown' : 'ungranted',
          },
        call: (role: McpRole, raw: unknown) => {
          if (this.closed || !this.broker) return Promise.reject(new Error('MCP ungranted'));
          return this.broker.call(role, raw);
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
    if (this.closed || !this.transport || !this.allOwned())
      throw new Error('Two owned running MCP instances required');
    this.broker ??= new McpTaskBroker(
      this.authority,
      {
        sourceInstanceId: this.instances.get(0)!,
        targetInstanceId: this.instances.get(1)!,
        workspaceId: this.workspaceId,
      },
      () => !this.closed && this.allOwned(),
    );
    return this.broker.prepare();
  }

  authorize(proof: unknown) {
    if (this.closed || !this.allOwned() || !this.broker) throw new Error('MCP unavailable');
    this.broker.authorize(proof);
  }

  snapshot() {
    return this.broker?.snapshot() ?? { state: this.closed ? 'unknown' : 'ungranted' };
  }

  private allOwned() {
    return (
      this.instances.size === 2 && [...this.instances].every(([slot, id]) => this.owned(slot, id))
    );
  }

  invalidate() {
    this.closed = true;
    this.broker?.close();
  }

  async close() {
    this.invalidate();
    await this.transport?.close();
  }
}
