import { lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readInteractiveTerminalConfig } from './interactive-profile.js';

/** Inspect the complete selection before creating a Core, journal or admission marker. */
export function inspectManagedTerminalFiles(files: readonly string[]) {
  if (files.length < 1 || files.length > 2) throw new Error('Select one or two terminal manifests');
  const identities = new Set<string>();
  const states: string[] = [];
  const sessions = new Set<string>();
  const selection = files.map((file) => {
    const config = readInteractiveTerminalConfig(file);
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
    let blocker: 'reuse_unavailable' | 'existing_state' | undefined =
      config.authentication && !config.interactive ? 'reuse_unavailable' : undefined;
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
  if (
    selection.some(({ config }) => config.interactive?.mcp) &&
    (selection.length !== 2 ||
      selection.some(({ config }) => !config.interactive?.mcp) ||
      selection[0]!.config.project !== selection[1]!.config.project)
  )
    throw new Error('MCP requires two opted-in terminals in one workspace');
  return selection;
}
