import { mcpCommunicationJournal } from './mcp-communication.js';
import { recordComposerMention } from './composer-mentions.js';
import {
  preserveOwnedExitPending,
  inspectPendingOwnedExits,
  readOwnedExitPending,
} from './exit-pending.js';
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
import { Store, FeaturePermissionRevisionConflict } from '@orqst/database';
import { TerminalAuthority } from './authority.js';
import { interactiveProvider } from './interactive-profile.js';
import { interactiveCliAdapter } from './interactive-adapters.js';
import { ManagedTerminalPair } from './managed-pair.js';
import { inspectManagedTerminalFiles } from './managed-files.js';
import { desktopAgentsAdmission } from '../managed-codex/desktop-admission.js';
import { DesktopAdmissionRefused } from '../managed-codex/desktop-admission-inspection.js';
import { terminalStartupFailureSchema, terminalStartupIdSchema } from './startup-failure.js';
import { terminalPairRPCSchema } from './rpc.js';
import { InteractiveMcpSession } from './interactive-mcp.js';
import { TerminalMessageHub } from './mcp-hub.js';
import { openHubEndpoint } from './mcp-hub-socket.js';
import { hubMessageJournal } from './mcp-hub-journal.js';
import { terminalDigest } from './authority.js';
import { terminalFile } from './codex-profile.js';
import type { TerminalMcpLaunch } from './mcp-launch.js';
import { terminalEnrollmentFile, inspectTerminalEnrollment } from './enrollment-files.js';

process.umask(0o077);
let startupStage: 'core_admission' | 'core_startup' = 'core_startup';
const startupId = terminalStartupIdSchema.parse(process.argv[6]);
function startupFailed(error: unknown) {
  const failure = terminalStartupFailureSchema.parse({
    type: 'startup-failure',
    id: startupId,
    failure: {
      stage: startupStage,
      code: error instanceof DesktopAdmissionRefused ? error.code : 'startup_failed',
      effects: 'possible',
    },
  });
  process.exitCode = 1;
  if (process.connected)
    process.send!(failure, () => {
      if (process.connected) process.disconnect();
    });
}
async function start() {
  if (!process.send || process.argv.length !== 7 || !/^v24\./.test(process.version))
    throw new Error('Private Node Core only');
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
  startupStage = 'core_admission';
  const admission = desktopAgentsAdmission(process.argv[4]!, files, authority.epoch);
  startupStage = 'core_startup';
  const stores: Store[] = [];
  let pair!: ManagedTerminalPair;
  // Feature-scoped hub for every terminal (docs/design/mcp-n-terminals.md); the disposable
  // pair session remains for manifests that opted into the pair only.
  const usesHub = selection.some(({ config }) => !!config.interactive?.hub);
  const pairMcp = !usesHub && !!selection[0]!.config.interactive?.mcp;
  const hubWorkspace = stableId('workspace', selection[0]!.config.project);
  const hubSlots: Array<{ terminalId: string; provider: string } | undefined> = selection.map(
    ({ config }) =>
      config.interactive?.hub
        ? { terminalId: terminalIdentity(config).terminalId, provider: interactiveProvider(config) }
        : undefined,
  );
  const hubNames: Record<string, string> = {
    codex: 'Codex',
    claude: 'Claude Code',
    opencode: 'OpenCode',
  };
  // Metadata-only recent events for the Studio projection (no text, owner sends excluded).
  const hubJournal = usesHub ? hubMessageJournal(process.argv[4]!, authority.epoch) : undefined;
  const hubEvents: Array<{
    id: string;
    from: string;
    to: string;
    kind: 'message' | 'delegation' | 'result';
    at: number;
    featureId: string;
  }> = [];
  const hub = usesHub
    ? new TerminalMessageHub(
        () => {
          const features = featureConfigurationDatabase(process.argv[4]!, hubWorkspace).list();
          return hubSlots.flatMap((member, slot) => {
            if (!member) return [];
            const owner = features.filter(
              (feature) =>
                feature.status !== 'archived' && feature.terminalIds.includes(member.terminalId),
            );
            return [
              {
                terminalId: member.terminalId,
                alias: `T-${String(slot + 1).padStart(3, '0')}`,
                name: hubNames[member.provider] ?? member.provider,
                provider: member.provider,
                featureId: owner.length === 1 ? owner[0]!.featureId : null,
                running: true,
              },
            ];
          });
        },
        (event) => {
          // Durable metadata-only audit, owner messages included; Studio shows terminals only.
          hubJournal?.append(event);
          if (event.from === 'owner') return;
          hubEvents.push({
            id: event.messageId,
            from: event.from,
            to: event.to,
            kind: event.kind === 'task' ? 'delegation' : event.kind,
            at: event.at,
            featureId: event.featureId,
          });
          if (hubEvents.length > 200) hubEvents.splice(0, hubEvents.length - 200);
        },
      )
    : undefined;
  const hubEndpoints: Array<Awaited<ReturnType<typeof openHubEndpoint>>> = [];
  const communication = pairMcp
    ? mcpCommunicationJournal(
        process.argv[4]!,
        authority.epoch,
        stableId('workspace', selection[0]!.config.project),
        [initialMembers[0]!.terminalId, initialMembers[1]!.terminalId],
        () =>
          featureConfigurationDatabase(
            process.argv[4]!,
            stableId('workspace', selection[0]!.config.project),
          ).list(),
      )
    : undefined;
  const mcp = pairMcp
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
        communication,
      )
    : undefined;
  try {
    const launches: TerminalMcpLaunch[] = [];
    const hubRelay = () => {
      const relayPath = join(__dirname, 'orqst-mcp-relay.cjs');
      return {
        path: relayPath,
        sha256: terminalDigest(terminalFile(relayPath, false, 16 * 1024 * 1024)),
      };
    };
    if (hub) {
      // One endpoint per possible slot, opened ahead: enrolled terminals bind to a free one.
      const relay = hubRelay();
      for (let slot = 0; slot < limit; slot++) {
        const endpoint = await openHubEndpoint(hub, () => hubSlots[slot]?.terminalId);
        hubEndpoints.push(endpoint);
        launches.push({
          serverName: `orqst_${randomUUID().replaceAll('-', '')}`,
          socketPath: endpoint.socketPath,
          capabilityFile: endpoint.capabilityFile,
          relay,
        });
      }
    }
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
          profiles: adapter.profiles(
            config,
            hub ? (config.interactive?.hub ? launches[slot] : undefined) : launches[slot],
          ),
          backend: (() => {
            const backend = adapter.backend(
              files[slot]!,
              join(__dirname, 'managed-terminal-host.cjs'),
              hub ? (config.interactive?.hub ? launches[slot] : undefined) : launches[slot],
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
    let draining = false;
    let preservedOwnedExit: ReturnType<typeof preserveOwnedExitPending> | undefined;
    function shutdown() {
      if (closed) return;
      closed = true;
      authority.revoke('desktop-managed');
      pair.close();
      void mcp?.close();
      hub?.close();
      hubJournal?.close();
      for (const endpoint of hubEndpoints) void endpoint.close();
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
        if (
          draining &&
          !['beginOwnedShutdown', 'preserveOwnedShutdown', 'prepareRetire', 'retire'].includes(
            request.kind,
          ) &&
          !(
            request.kind === 'terminal' &&
            ['snapshot', 'read', 'requestStop', 'stop', 'revokeInput', 'detach'].includes(
              request.request.operation,
            )
          )
        )
          throw new Error('Owned Core shutdown in progress');
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
              // Enrolled slots take the next index; hub terminals use that slot's endpoint.
              const enrolledSlot = selection.length;
              const hubLaunch = hub && config.interactive?.hub ? launches[enrolledSlot] : undefined;
              if (hub && config.interactive?.hub && !hubLaunch)
                throw new Error('No free hub endpoint');
              // A hub Core only admits hub terminals: every terminal has ORQST messaging.
              if (hub && !config.interactive?.hub)
                throw new Error('Hub Core requires hub terminals');
              const profiles = adapter.profiles(config, hubLaunch);
              const backend = adapter.backend(
                request.manifestFile,
                join(__dirname, 'managed-terminal-host.cjs'),
                hubLaunch,
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
                const config = inspected.candidate.config;
                if (hub && config.interactive?.hub)
                  hubSlots[selection.length] = {
                    terminalId: terminalIdentity(config).terminalId,
                    provider: interactiveProvider(config),
                  };
                selection.push({ config, blocker: undefined });
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
          case 'composerMention':
            value = recordComposerMention(
              process.argv[4]!,
              stableId('workspace', selection[0]!.config.project),
              request.featureId,
              selection.map(({ config }) => terminalIdentity(config).terminalId),
              request.input,
              hub && request.featureId
                ? (terminalId, text) => {
                    try {
                      hub.ownerSend(request.featureId!, terminalId, text);
                      return { delivery: 'queued', reason: 'hub_inbox' };
                    } catch (error) {
                      const code = (error as { code?: string }).code;
                      return {
                        delivery: 'denied',
                        reason:
                          code === 'inbox_full'
                            ? 'inbox_full'
                            : code === 'unknown_terminal'
                              ? 'unknown_terminal'
                              : 'unavailable',
                      };
                    }
                  }
                : undefined,
            );
            break;
          case 'communicationProjection':
            if (communication || hub) admission.assertOwner();
            value = hub
              ? {
                  events: hubEvents
                    .filter((event) => event.featureId === request.featureId)
                    .slice(-50)
                    .map(({ id, from, to, kind, at }) => ({ id, from, to, kind, at })),
                }
              : (communication?.project(request.featureId) ?? null);
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
          case 'featurePermissionsRead':
            value = features().readPermissions(request.featureId);
            break;
          case 'featurePermissionsSave':
            try {
              value = {
                status: 'ok',
                permissions: features().savePermissions(
                  request.featureId,
                  request.actorId,
                  request.input,
                ),
              };
            } catch (error) {
              if (!(error instanceof FeaturePermissionRevisionConflict)) throw error;
              value = { status: 'conflict' };
            }
            break;
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
          case 'closeSlot': {
            mcp?.invalidate();
            // The terminal's hub inbox survives a view close or reload (unread messages
            // were already reported as queued to their senders).
            pair.closeSlot(request.slot);
            break;
          }
          case 'beginOwnedShutdown':
            draining = true;
            mcp?.invalidate();
            if (preservedOwnedExit) {
              admission.preservePendingExit();
              const record = readOwnedExitPending(
                process.argv[4]!,
                admission.owner,
                authority.epoch,
              );
              if (JSON.stringify(record) !== JSON.stringify(preservedOwnedExit))
                throw new Error('Pending exit evidence changed');
              value = record!.evidence;
            } else value = pair.ownedShutdownInventory();
            break;
          case 'preserveOwnedShutdown':
            if (!draining || !selection.some(({ config }) => config.version === 3))
              throw new Error('Preserved owned exit is unavailable');
            value =
              preservedOwnedExit ??
              preserveOwnedExitPending(
                process.argv[4]!,
                {
                  version: 1,
                  status: 'leader_exited_retirement_pending',
                  owner: admission.owner,
                  evidence: pair.ownedExitEvidence(),
                },
                admission.assertOwner,
              );
            preservedOwnedExit = value as ReturnType<typeof preserveOwnedExitPending>;
            admission.preservePendingExit();
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
      pendingOwnedExits: inspectPendingOwnedExits(process.argv[4]!),
      id: startupId,
      epoch: authority.epoch,
      admissionOwner: admission.owner,
      initialFiles: [...files],
      identities: selection.map(({ config }, slot) => ({
        slot,
        ...terminalIdentity(config),
        provider: interactiveProvider(config),
      })),
    });
  } catch (error) {
    startupFailed(error);
    authority.revoke('desktop-managed');
    pair?.close();
    await mcp?.close();
    hub?.close();
    for (const endpoint of hubEndpoints) await endpoint.close().catch(() => {});
    for (const store of stores) store.close();
    process.exitCode = 1;
  }
}
void start().catch(startupFailed);
