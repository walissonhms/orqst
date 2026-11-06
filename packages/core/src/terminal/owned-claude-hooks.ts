import { constants, closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { terminalDirectory, terminalFile } from './codex-profile.js';
import type { ManagedClaudeConfig } from './interactive-profile.js';

const channelMaximum = 128 * 1024;
const settingsName = 'claude-hooks-settings.json';
const scriptName = 'claude-hooks.cjs';
const channelName = 'claude-hook-events.jsonl';
const hookRecord = z.strictObject({
  version: z.literal(1),
  sessionId: z.uuid(),
  promptId: z.uuid(),
  event: z.enum([
    'prompt',
    'progress',
    'permission_prompt',
    'idle_prompt',
    'stop',
    'failure',
    'unmatched',
  ]),
  at: z.number().int().nonnegative().safe(),
});

export function claudeOwnedHooksPath(config: ManagedClaudeConfig) {
  return join(config.state, settingsName);
}

/** Original ORQST metadata writer. It never outputs a hook decision or persists input content. */
export function claudeOwnedHookFiles(config: ManagedClaudeConfig) {
  const root =
    config.authentication.claudeConfigDirectory ?? join(config.authentication.home, '.claude');
  const transcript = join(
    root,
    'projects',
    config.project.replace(/[^a-zA-Z0-9-]/g, '-'),
    `${config.sessionId}.jsonl`,
  );
  const script = `'use strict';
const fs = require('node:fs');
const expected = ${JSON.stringify({ sessionId: config.sessionId, project: config.project, transcript, state: config.state, channel: join(config.state, channelName) })};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let chunks = [], length = 0, rejected = false;
const deadline = setTimeout(() => process.stdin.destroy(), 1000);
process.stdin.on('close', () => clearTimeout(deadline));
process.stdin.on('error', () => clearTimeout(deadline));
process.stdin.on('data', (chunk) => {
  length += chunk.length;
  if (length > 65536) { rejected = true; chunks = []; process.stdin.destroy(); }
  else chunks.push(chunk);
});
process.stdin.on('end', () => {
  clearTimeout(deadline);
  let fd;
  try {
    if (rejected) return;
    const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    chunks = [];
    if (!raw || Array.isArray(raw) || typeof raw !== 'object' || raw.agent_id !== undefined ||
        raw.session_id !== expected.sessionId || !uuid.test(raw.prompt_id ?? '')) return;
    const matched = raw.cwd === expected.project && raw.transcript_path === expected.transcript;
    const event = !matched ? 'unmatched' : raw.hook_event_name === 'UserPromptSubmit' ? 'prompt' :
      ['PostToolUse', 'PostToolUseFailure'].includes(raw.hook_event_name) ? 'progress' :
      raw.hook_event_name === 'Stop' ? 'stop' :
      raw.hook_event_name === 'StopFailure' ? 'failure' :
      raw.hook_event_name === 'Notification' && ['permission_prompt', 'idle_prompt'].includes(raw.notification_type) ? raw.notification_type : undefined;
    if (!event) return;
    if (fs.realpathSync(expected.state) !== expected.state || fs.realpathSync(expected.channel) !== expected.channel) return;
    const directory = fs.lstatSync(expected.state);
    if (!directory.isDirectory() || directory.uid !== process.getuid() || (directory.mode & 63)) return;
    fd = fs.openSync(expected.channel, fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const file = fs.fstatSync(fd);
    const selected = fs.lstatSync(expected.channel);
    const line = JSON.stringify({ version: 1, sessionId: expected.sessionId, promptId: raw.prompt_id, event, at: Date.now() }) + String.fromCharCode(10);
    if (!file.isFile() || file.uid !== process.getuid() || (file.mode & 63) || file.nlink !== 1 ||
        file.ino !== selected.ino || file.dev !== selected.dev) return;
    if (event === 'progress' && file.size > 0 && file.size < ${channelMaximum}) {
      const tail = Buffer.alloc(Math.min(file.size, 512));
      if (fs.readSync(fd, tail, 0, tail.length, file.size - tail.length) !== tail.length) return;
      const lines = tail.toString('utf8').split(String.fromCharCode(10));
      const last = lines.at(-2);
      if (lines.at(-1) === '' && last) {
        const prior = JSON.parse(last);
        if (prior.version === 1 && prior.sessionId === expected.sessionId &&
            prior.promptId === raw.prompt_id && ['prompt', 'progress'].includes(prior.event)) return;
      }
    }
    if (file.size + Buffer.byteLength(line) > ${channelMaximum}) {
      if (file.size < ${channelMaximum}) fs.writeSync(fd, "!");
      return;
    }
    if (fs.writeSync(fd, line) !== Buffer.byteLength(line)) return;
    fs.fsyncSync(fd);
  } catch { /* Missing/unsafe evidence does not control the CLI. */ }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
});
`;
  const quote = (word: string) => "'" + word.replaceAll("'", `'"'"'`) + "'";
  const command = `${quote(config.node.path)} ${quote(join(config.state, scriptName))}`;
  const handler = { type: 'command', command, timeout: 2 };
  const settings =
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [handler] }],
        PostToolUse: [{ hooks: [handler] }],
        PostToolUseFailure: [{ hooks: [handler] }],
        Notification: [{ matcher: 'permission_prompt|idle_prompt', hooks: [handler] }],
        Stop: [{ hooks: [handler] }],
        StopFailure: [{ hooks: [handler] }],
      },
    }) + '\n';
  return { [settingsName]: settings, [scriptName]: script };
}

/** Exact generated files are part of the approved profile; no user settings are read or changed. */
export function validateClaudeOwnedHooks(config: ManagedClaudeConfig) {
  if (!config.ownedHooks) return;
  if (config.executableVersion !== '2.1.318' || (config.interactive.mcp && !config.interactive.hub))
    throw new Error('Owned hooks require the reviewed Claude TUI contract');
  terminalDirectory(config.state, true);
  for (const [name, expected] of Object.entries(claudeOwnedHookFiles(config))) {
    if (terminalFile(join(config.state, name), true, 16 * 1024).toString('utf8') !== expected)
      throw new Error('Owned hook configuration changed');
  }
}

/** Pin the empty channel before dispatch. It is used only after canonical transcript proof. */
export function ownedClaudeHookEvidence(config: ManagedClaudeConfig) {
  validateClaudeOwnedHooks(config);
  const file = join(config.state, channelName);
  const inspect = () => {
    terminalDirectory(config.state, true);
    if (realpathSync(file) !== file) throw new Error('Owned hook channel changed');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = fstatSync(fd);
      if (
        !info.isFile() ||
        info.uid !== process.getuid?.() ||
        info.mode & 0o077 ||
        info.nlink !== 1 ||
        info.size >= channelMaximum
      )
        throw new Error('Owned hook channel unavailable');
      const bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!count) throw new Error('Incomplete owned hook channel');
        offset += count;
      }
      const after = fstatSync(fd);
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs)
        throw new Error('Owned hook channel changed during read');
      return { info, bytes };
    } finally {
      closeSync(fd);
    }
  };
  const initial = inspect();
  if (initial.bytes.length) throw new Error('Existing hook channel cannot be adopted');
  let invalid = false;
  let previous = Buffer.alloc(0);
  return (): {
    agentState: 'running' | 'waiting_for_user' | 'completed' | 'failed' | 'unknown';
    turnId?: string;
  } => {
    const unknown = { agentState: 'unknown' as const };
    try {
      if (invalid) return unknown;
      validateClaudeOwnedHooks(config);
      const { info, bytes } = inspect();
      if (
        info.ino !== initial.info.ino ||
        info.dev !== initial.info.dev ||
        bytes.length < previous.length ||
        !bytes.subarray(0, previous.length).equals(previous)
      ) {
        invalid = true;
        return unknown;
      }
      previous = bytes;
      if (!bytes.length) return unknown;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!text.endsWith('\n')) return unknown;
      let state: {
        agentState: 'running' | 'waiting_for_user' | 'completed' | 'failed' | 'unknown';
        turnId?: string;
      } = unknown;
      const closed = new Set<string>();
      for (const line of text.slice(0, -1).split('\n')) {
        if (line.length > 512) return unknown;
        const event = hookRecord.parse(JSON.parse(line));
        if (event.sessionId !== config.sessionId) return unknown;
        if (event.event === 'unmatched') {
          closed.add(event.promptId);
          state = unknown;
          continue;
        }
        if (event.event === 'prompt') {
          if (closed.has(event.promptId)) return unknown;
          if (state.turnId && state.turnId !== event.promptId) closed.add(state.turnId);
          state = { agentState: 'running', turnId: event.promptId };
        } else {
          if (!state.turnId) continue;
          if (state.turnId !== event.promptId) return unknown;
          state = {
            agentState:
              event.event === 'progress'
                ? 'running'
                : event.event === 'stop'
                  ? 'completed'
                  : event.event === 'failure'
                    ? 'failed'
                    : 'waiting_for_user',
            turnId: event.promptId,
          };
        }
      }
      return state;
    } catch {
      return unknown;
    }
  };
}

export const claudeOwnedHookChannelName = channelName;
