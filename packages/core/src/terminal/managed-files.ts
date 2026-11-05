import { terminalSlotLimit } from '@orqst/protocol';
import { terminalIdentity } from './identity.js';
import { lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readInteractiveTerminalConfig, interactiveProvider } from './interactive-profile.js';
import { findCliContract } from './cli-contract.js';

/** Inspect the complete selection before creating a Core, journal or admission marker. */
export function inspectManagedTerminalFiles(files: readonly string[], limit?: number) {
  const capacity = terminalSlotLimit(limit);
  if (files.length < 1 || files.length > capacity)
    throw new Error('Terminal selection exceeds capacity');
  const terminalIds = new Set<string>();
  const identities = new Set<string>();
  const states: string[] = [];
  const sessions = new Set<string>();
  const selection = files.map((file) => {
    const config = readInteractiveTerminalConfig(file);
    const { terminalId } = terminalIdentity(config);
    if (terminalIds.has(terminalId)) throw new Error('Duplicate terminal identity');
    terminalIds.add(terminalId);
    if (config.version === 2) {
      if (sessions.has(config.sessionId)) throw new Error('Duplicate Claude session UUID');
      sessions.add(config.sessionId);
    }
    for (const path of [file, config.state]) {
      const info = lstatSync(path);
      const identity = `${info.dev}:${info.ino}`;
      if (identities.has(identity)) throw new Error('Duplicate terminal manifest or state');
      identities.add(identity);
    }
    for (const state of states)
      for (const path of [relative(state, config.state), relative(config.state, state)])
        if (path === '' || (path !== '..' && !path.startsWith('../')))
          throw new Error('Overlapping terminal state');
    states.push(config.state);
    let blocker:
      | 'reuse_unavailable'
      | 'existing_state'
      | 'opencode_startup_required'
      | 'launch_unavailable'
      | undefined = config.authentication && !config.interactive ? 'reuse_unavailable' : undefined;
    if (
      config.version === 2 &&
      !findCliContract('claude', config.interactive.mcp ? 'mcp' : 'tui', config.executableVersion)
    )
      blocker = 'launch_unavailable';
    if (config.version === 3 && !config.interactive.nativeStartupAuthorized)
      blocker = 'opencode_startup_required';
    for (const name of ['terminal.sqlite', 'desktop-communication.sqlite']) {
      try {
        lstatSync(join(config.state, name)); // Dangling symlinks also reserve the state.
        blocker ??= 'existing_state';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return { config, blocker };
  });
  const providers = new Set(selection.map(({ config }) => interactiveProvider(config)));
  // The only reviewed heterogeneous contract is a two-member Codex/OpenCode pair.
  const codexOpenCodePair =
    selection.length === 2 && providers.has('codex') && providers.has('opencode');
  if (providers.size !== 1 && !codexOpenCodePair)
    throw new Error('Terminal team requires one provider except for a Codex/OpenCode pair');
  if (selection.some(({ config }) => config.project !== selection[0]!.config.project))
    throw new Error('Terminal team requires one workspace');
  if (
    selection.some(({ config }) => config.interactive?.mcp) &&
    (selection.length !== 2 ||
      selection.some(({ config }) => !config.interactive?.mcp) ||
      selection[0]!.config.project !== selection[1]!.config.project)
  )
    throw new Error('MCP requires two opted-in terminals in one workspace');
  return selection;
}
