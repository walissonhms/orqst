import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rust = (name: string) => readFileSync(`apps/tauri/src-tauri/src/${name}.rs`, 'utf8');

test('every registered renderer command has a reviewed admission path', () => {
  const handler = rust('main').match(/generate_handler!\[([^\]]+)\]/)?.[1];
  assert.ok(handler);
  const registered = handler
    .split(',')
    .map((entry) => entry.trim())
    .sort();
  const routes: Record<string, [string, string]> = {
    'agents::agents_request': ['agents', 'let action = match request["action"]'],
    'features::feature_permissions': ['features', 'Action::Permissions'],
    'features::feature_prepare': ['features', 'Action::Navigate'],
    'features::feature_request': ['features', 'Action::Metadata'],
    'files::file_request': ['files', 'Action::File'],
    'terminal::terminal_open_prepared': ['terminal', 'Action::Open'],
    'terminal::terminal_request': ['terminal', 'Action::Input'],
    'terminal::terminal_restore': ['terminal', 'with_chrome_document(app, document'],
    'terminal::terminal_view': ['terminal', 'Action::View'],
    'terminal_creation::studio_request': ['terminal_creation', 'Action::Catalog'],
  };
  assert.deepEqual(registered, Object.keys(routes).sort());
  for (const [name, [file, marker]] of Object.entries(routes)) {
    const source = rust(file);
    const start = source.indexOf(`pub async fn ${name.split('::')[1]}(`);
    assert.ok(start >= 0, `${name}: missing command`);
    const next = source.indexOf('#[tauri::command]', start);
    const body = source.slice(start, next < 0 ? undefined : next);
    assert.ok(body.includes(marker), `${name}: missing admission marker`);
    assert.ok(body.includes('renderer_admission::admit('), `${name}: missing limiter`);
  }
  const terminal = rust('terminal');
  for (const action of [
    'open',
    'start',
    'attach',
    'input',
    'write',
    'paste',
    'resize',
    'read',
    'snapshot',
    'detach',
    'stop',
  ]) {
    assert.ok(
      terminal
        .slice(terminal.indexOf('let action = match request["action"]'))
        .split('_ => return denied()')[0]
        ?.includes(`"${action}"`),
      action,
    );
  }
  const agents = rust('agents');
  for (const action of ['snapshot', 'retire', 'routing', 'start', 'delegate', 'stop']) {
    assert.ok(
      agents
        .slice(agents.indexOf('let action = match request["action"]'))
        .split('_ => return denied()')[0]
        ?.includes(`"${action}"`),
      action,
    );
  }
});
