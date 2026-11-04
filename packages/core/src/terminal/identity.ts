import { terminalDigest } from './authority.js';

/** Metadata only. This ID is never an authority, process binding or message target. */
export function terminalIdentity(config: { state: string; identity?: { terminalId: string } }) {
  if (config.identity) return { ...config.identity, alias: `P-${config.identity.terminalId}` };
  const hash = terminalDigest(JSON.stringify(['legacy-terminal-state', config.state]));
  const terminalId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return { terminalId, alias: `P-${terminalId}` };
}
