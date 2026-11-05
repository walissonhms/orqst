// Native Terminal authority; only explicit trusted composition enrolls a client.
import { createHash, randomUUID, verify, type KeyObject } from 'node:crypto';

export type TerminalOperation =
  'start' | 'attach' | 'input' | 'paste' | 'stop' | 'retire' | 'delegate';
export interface TerminalBinding {
  operation: TerminalOperation;
  target: string;
  digest: string;
}
export interface TerminalChallenge extends TerminalBinding {
  version: 1;
  epoch: string;
  clientId: string;
  challengeId: string;
  expiresAt: number;
}
export interface TerminalProof {
  challengeId: string;
  signature: string;
  cliAuthorizationEpoch?: string;
}

export function terminalDigest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** The native signer must sign these exact bytes after confirming the bound action. */
export function terminalChallengeBytes(
  value: TerminalChallenge,
  cliAuthorizationEpoch?: string,
): Buffer {
  const fields = [
    'orqst.terminal',
    value.version,
    value.epoch,
    value.clientId,
    value.challengeId,
    value.expiresAt,
    value.operation,
    value.target,
    value.digest,
  ];
  return Buffer.from(
    JSON.stringify(
      cliAuthorizationEpoch === undefined
        ? fields
        : [...fields, 'orqst.cli-policy', cliAuthorizationEpoch],
    ),
  );
}

/** Trusted composition supplies public keys; no renderer/cookie enrollment or signing API. */
export class TerminalAuthority {
  readonly epoch = randomUUID();
  private clients = new Map<string, KeyObject>();
  private pending = new Map<string, Readonly<TerminalChallenge>>();

  constructor(
    clients: ReadonlyMap<string, KeyObject>,
    readonly now: () => number = () => performance.now(),
  ) {
    if (clients.size > 8) throw new Error('Terminal client limit exceeded');
    for (const [id, key] of clients) {
      if (!id || id.length > 128 || key.type !== 'public' || key.asymmetricKeyType !== 'ed25519')
        throw new Error('Invalid terminal client');
      this.clients.set(id, key);
    }
  }

  isEnrolled(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  revoke(clientId: string): void {
    this.clients.delete(clientId);
    for (const [id, challenge] of this.pending) {
      if (challenge.clientId === clientId) this.pending.delete(id);
    }
  }

  prepare(clientId: string, binding: TerminalBinding): Readonly<TerminalChallenge> {
    if (!this.isEnrolled(clientId)) throw new Error('Terminal client is not enrolled');
    if (
      !['start', 'attach', 'input', 'paste', 'stop', 'retire', 'delegate'].includes(
        binding.operation,
      ) ||
      !binding.target ||
      binding.target.length > 128 ||
      !/^[a-f0-9]{64}$/.test(binding.digest)
    )
      throw new Error('Invalid terminal binding');
    const now = this.now();
    for (const [id, challenge] of this.pending) {
      if (challenge.expiresAt <= now) this.pending.delete(id);
    }
    if (this.pending.size >= 128) throw new Error('Terminal challenge limit exceeded');
    const challenge = Object.freeze({
      version: 1 as const,
      epoch: this.epoch,
      clientId,
      challengeId: randomUUID(),
      expiresAt: now + 30_000,
      operation: binding.operation,
      target: binding.target,
      digest: binding.digest,
    });
    this.pending.set(challenge.challengeId, challenge);
    return challenge;
  }

  /** Consumed before side effects. An ambiguous/failed operation must never retry this proof. */
  consume(proof: unknown, binding: TerminalBinding): string {
    if (!proof || typeof proof !== 'object') throw new Error('Invalid terminal proof');
    const value = proof as Partial<TerminalProof>;
    if (
      !Object.keys(proof).every((key) =>
        ['challengeId', 'signature', 'cliAuthorizationEpoch'].includes(key),
      ) ||
      (value.cliAuthorizationEpoch !== undefined &&
        (binding.operation !== 'start' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            value.cliAuthorizationEpoch,
          ))) ||
      typeof value.challengeId !== 'string' ||
      typeof value.signature !== 'string' ||
      !/^[A-Za-z0-9_-]{86}$/.test(value.signature)
    )
      throw new Error('Invalid terminal proof');
    const challenge = this.pending.get(value.challengeId);
    if (
      !challenge ||
      !this.isEnrolled(challenge.clientId) ||
      challenge.expiresAt <= this.now() ||
      challenge.operation !== binding.operation ||
      challenge.target !== binding.target ||
      challenge.digest !== binding.digest ||
      !verify(
        null,
        terminalChallengeBytes(challenge, value.cliAuthorizationEpoch),
        this.clients.get(challenge.clientId)!,
        Buffer.from(value.signature, 'base64url'),
      )
    )
      throw new Error('Terminal authorization denied');
    this.pending.delete(challenge.challengeId);
    return challenge.clientId;
  }
}
