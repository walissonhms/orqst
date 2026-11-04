import { stableId } from '@orqst/shared';
import {
  terminalSlotLimit,
  terminalEnrollmentInspectionSchema,
  terminalEnrollmentReceiptSchema,
} from '@orqst/protocol';
import { featureConfigurationDatabase } from './feature-configuration.js';
import { terminalTeamDatabase } from './team-database.js';
import { terminalLayoutDatabase } from './layout-database.js';
import { terminalIdentity } from './identity.js';
// UI-independent owned Terminal component. The observer composition never imports this entry.
import { createPublicKey, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Store } from '@orqst/database';
import { TerminalAuthority } from './authority.js';
import { interactiveProvider } from './interactive-profile.js';
import { interactiveCliAdapter } from './interactive-adapters.js';
import { ManagedTerminalPair } from './managed-pair.js';
import { inspectManagedTerminalFiles } from './managed-files.js';
import { desktopAgentsAdmission } from '../managed-codex/desktop-admission.js';
import { terminalPairRPCSchema } from './rpc.js';
import { InteractiveMcpSession } from './interactive-mcp.js';
import { terminalDigest } from './authority.js';
import { terminalFile } from './codex-profile.js';
import type { TerminalMcpLaunch } from './mcp-launch.js';
import { terminalEnrollmentFile, inspectTerminalEnrollment } from './enrollment-files.js';

process.umask(0o077);
if (!process.send || ![5, 6].includes(process.argv.length) || !/^v24\./.test(process.version))
  throw new Error('Private Node Core only');
async function start() {
  const files: string[] = JSON.parse(process.argv[2]!);
  const limit = terminalSlotLimit(
    process.argv[5] === undefined ? undefined : Number(process.argv[5]),
  );
  const selection = inspectManagedTerminalFiles(files, limit);
  if (selection.some((slot) => slot.blocker)) throw new Error('Terminal profile blocked');
  const enrollmentFiles = selection.map(({ config }, slot) =>
    terminalEnrollmentFile(files[slot]!, config),
  );
  const initialMembers = enrollmentFiles.map(({ config, bindingDigest }, slot) => ({
    ...terminalIdentity(config),
    slot,
    provider: interactiveProvider(config),
    ...(config.model ? { requestedModel: config.model.value } : {}),
    workspaceId: stableId('workspace', config.project),
    featureId: config.preparation?.featureId ?? null,
    admissionRevision: 0,
    bindingDigest,
    status: 'ready' as const,
  }));
  const publicKey = createPublicKey({
    key: Buffer.from(process.argv[3]!, 'base64url'),
    type: 'spki',
    format: 'der',
  });
  const authority = new TerminalAuthority(new Map([['desktop-managed', publicKey]]), Date.now);
  const admission = desktopAgentsAdmission(process.argv[4]!, files);
  const stores: Store[] = [];
  let pair!: ManagedTerminalPair;
  const mcp = selection[0]!.config.interactive?.mcp
    ? new InteractiveMcpSession(
        authority,
        terminalDigest(selection[0]!.config.project),
        (slot, id) => {
          try {
            admission.assertOwner();
            const snapshot = pair.dispatch(slot, {
              id: randomUUID(),
              operation: 'snapshot',
              args: [id],
            }) as { state: string; epoch: string };
            return snapshot.state === 'running' && snapshot.epoch === authority.epoch;
          } catch {
            return false;
          }
        },
      )
    : undefined;
  try {
    const launches: TerminalMcpLaunch[] = [];
    if (mcp) {
      const relayPath = join(__dirname, 'orqst-mcp-relay.cjs');
      const relay = {
        path: relayPath,
        sha256: terminalDigest(terminalFile(relayPath, false, 16 * 1024 * 1024)),
      };
      const endpoints = await mcp.open();
      for (const endpoint of endpoints)
        launches.push({
          serverName: `orqst_${randomUUID().replaceAll('-', '')}`,
          socketPath: endpoint.socketPath,
          capabilityFile: endpoint.capabilityFile,
          relay,
        });
    }
    pair = new ManagedTerminalPair(
      authority,
      selection.map(({ config }, slot) => {
        const adapter = interactiveCliAdapter(
          interactiveProvider(config),
          config.authentication ? 'reuse-existing' : 'separate-login',
          !!config.interactive,
        );
        const store = new Store(join(config.state, 'terminal.sqlite'));
        stores.push(store);
        return {
          profiles: adapter.profiles(config, launches[slot]),
          backend: (() => {
            const backend = adapter.backend(
              files[slot]!,
              join(__dirname, 'managed-terminal-host.cjs'),
              launches[slot],
            );
            return mcp ? mcp.wrap(slot, backend) : backend;
          })(),
          journal: store.terminalJournal(authority.epoch, { recover: false }),
        };
      }),
      admission,
      limit,
    );
    // Only this Core chooses the fixed metadata path and reviewed member set.
    const layouts = () =>
      terminalLayoutDatabase(
        process.argv[4]!,
        selection.map(({ config }) => terminalIdentity(config).terminalId),
      );
    const features = () =>
      featureConfigurationDatabase(
        process.argv[4]!,
        stableId('workspace', selection[0]!.config.project),
      );
    const teams = () =>
      terminalTeamDatabase(
        process.argv[4]!,
        selection.map(({ config }) => terminalIdentity(config).terminalId),
        terminalDigest(selection[0]!.config.project),
      );
    const send = (value: object) => {
      if (process.connected)
        process.send!(value, (error) => {
          if (error) shutdown();
        });
    };
    let closed = false;
    function shutdown() {
      if (closed) return;
      closed = true;
      authority.revoke('desktop-managed');
      pair.close();
      void mcp?.close();
      for (const store of stores) store.close();
      if (process.connected) process.disconnect();
    }
    process.on('disconnect', shutdown);
    process.on('message', (raw: unknown) => {
      if (closed) return;
      const parsed = terminalPairRPCSchema.safeParse(raw);
      if (!parsed.success) return shutdown();
      const request = parsed.data;
      const id = request.kind === 'terminal' ? request.request.id : request.id;
      try {
        let value: unknown;
        switch (request.kind) {
          case 'enrollmentInspect': {
            const state = pair.enrollmentInspect(request.opId);
            value = terminalEnrollmentInspectionSchema.parse({
              ...state,
              members: [...initialMembers, ...state.members],
            });
            break;
          }
          case 'enroll': {
            let inspected: ReturnType<typeof inspectTerminalEnrollment> | undefined;
            const receipt = pair.enroll(request.input, request.manifestFile, () => {
              inspected = inspectTerminalEnrollment(
                request.manifestFile,
                request.input,
                enrollmentFiles,
              );
              const reviewed = inspected;
              const config = reviewed.candidate.config;
              if (config.preparation?.preferencesDirectory !== process.argv[4])
                throw new Error('Enrollment preferences scope changed');
              const adapter = interactiveCliAdapter(
                interactiveProvider(config),
                'reuse-existing',
                true,
              );
              const profiles = adapter.profiles(config);
              const backend = adapter.backend(
                request.manifestFile,
                join(__dirname, 'managed-terminal-host.cjs'),
              );
              reviewed.validate();
              return {
                member: reviewed.member,
                create: () => {
                  // Last check before durable journal effects. Existing slots are never rebuilt.
                  reviewed.validate();
                  admission.assertOwner();
                  const store = new Store(join(config.state, 'terminal.sqlite'));
                  stores.push(store);
                  const journal = store.terminalJournal(authority.epoch, { recover: false });
                  reviewed.validate();
                  return {
                    profiles,
                    journal,
                    backend: {
                      preflight: () => {
                        reviewed.validate();
                        backend.preflight?.();
                      },
                      validate: (profile) => {
                        reviewed.validate();
                        return backend.validate(profile);
                      },
                      start: (profile, events, identity) => {
                        reviewed.validate();
                        return backend.start(profile, events, identity);
                      },
                    },
                  };
                },
              };
            });
            if (inspected && receipt.member) {
              // Includes uncertain reservations: never reuse their identities or state paths.
              enrollmentFiles.push(inspected.candidate);
              if (receipt.status === 'ready') {
                files.push(request.manifestFile);
                selection.push({ config: inspected.candidate.config, blocker: undefined });
              }
            }
            value = terminalEnrollmentReceiptSchema.parse(receipt);
            break;
          }
          case 'featureViewRead':
            value = features().readView();
            break;
          case 'featureViewSave':
            value = features().saveView(request.input);
            break;
          case 'featureList':
            value = features().list();
            break;
          case 'featureRead':
            value = features().read(request.featureId);
            break;
          case 'featureCreate':
            value = features().create(request.input);
            break;
          case 'featureUpdate':
            value = features().update(request.featureId, request.input);
            break;
          case 'featureAssign': {
            const selected = selection[request.slot];
            if (!selected) throw new Error('Unknown reviewed terminal');
            value = features().assignTerminal(
              request.featureId,
              terminalIdentity(selected.config).terminalId,
              request.expectedRevision,
            );
            break;
          }
          case 'featureTeamRead':
            value = features().readTeam(request.featureId);
            break;
          case 'featureTeamSave':
            value = features().saveTeam(request.featureId, request.input);
            break;
          case 'featureLayoutRead':
            value = features().readLayout(request.featureId);
            break;
          case 'featureLayoutSave':
            value = features().saveLayout(request.featureId, request.record);
            break;
          case 'teamRead':
            value = teams().read();
            break;
          case 'teamSave':
            value = teams().save(request.input);
            break;
          case 'layoutRead':
            value = layouts().read();
            break;
          case 'layoutSave':
            layouts().save(request.record);
            break;
          case 'layoutImport':
            value = layouts().import(request.record);
            break;
          case 'terminal':
            value = pair.dispatch(request.slot, request.request);
            break;
          case 'closeSlot':
            mcp?.invalidate();
            pair.closeSlot(request.slot);
            break;
          case 'prepareRetire':
            if (selection.some(({ config }) => config.version === 3))
              throw new Error('OpenCode descendant exit unvalidated; capacity remains reserved');
            value = pair.prepareRetire();
            break;
          case 'retire':
            if (selection.some(({ config }) => config.version === 3))
              throw new Error('OpenCode descendant exit unvalidated; capacity remains reserved');
            pair.retire(request.proof);
            void mcp?.close();
            break;
          case 'prepareMcp':
            if (!mcp) throw new Error('MCP not opted in');
            value = mcp.prepare();
            break;
          case 'authorizeMcp':
            if (!mcp) throw new Error('MCP not opted in');
            mcp.authorize(request.proof);
            break;
        }
        send({ id, ok: true, value: value ?? null });
      } catch {
        send({ id, ok: false });
      }
    });
    send({
      type: 'ready',
      epoch: authority.epoch,
      identities: selection.map(({ config }, slot) => ({
        slot,
        ...terminalIdentity(config),
        provider: interactiveProvider(config),
      })),
    });
  } catch {
    authority.revoke('desktop-managed');
    pair?.close();
    await mcp?.close();
    for (const store of stores) store.close();
    if (process.connected) process.disconnect();
    process.exitCode = 1;
  }
}
void start().catch(() => {
  if (process.connected) process.disconnect();
  process.exitCode = 1;
});
