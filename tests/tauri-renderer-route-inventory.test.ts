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
    'terminal::terminal_request': ['terminal', 'terminal_request_admission('],
    'terminal::terminal_restore': ['terminal', 'with_chrome_document(app, document'],
    'terminal::terminal_view': ['terminal', 'Action::View'],
    'terminal_creation::studio_request': ['terminal_creation', 'Action::Catalog'],
  };
  assert.deepEqual(registered, Object.keys(routes).sort());
  const guards: Record<string, string[]> = {
    'agents::agents_request': ['!current(&window)', 'mutation && !focus', '!= document'],
    'features::feature_permissions': ['identity(&window)', 'focus_then_current(', '!= feature_id'],
    'features::feature_prepare': [
      'identity(&window)',
      'focus_then_current(',
      'preparation_scope_current(',
    ],
    'features::feature_request': [
      'identity(&window)',
      '!focused(&window).await',
      'metadata_context(app)',
    ],
    'files::file_request': [
      '!current(&window, &r.origin)',
      '!window.is_focused()',
      'r.document == 0',
    ],
    'terminal::terminal_open_prepared': [
      'slot(&window)',
      '!focused(&window).await',
      'intent.current(',
    ],
    'terminal::terminal_request': ['slot(&window)', '!focus', '!= document'],
    'terminal::terminal_restore': [
      'chrome_identity(&window)',
      'document_version_current(',
      'with_chrome_document(',
    ],
    'terminal::terminal_view': [
      'slot(&window)',
      '!focused(&window).await',
      '|| self::slot(&window) != Some(slot)',
    ],
    'terminal_creation::studio_request': [
      'identity(&window)',
      'dashboard_identity(&window)',
      'focused(&window).await',
      'request["generation"].as_u64()',
      'studio_admission(focused, current',
    ],
  };
  assert.deepEqual(Object.keys(guards).sort(), registered);
  for (const [name, [file, marker]] of Object.entries(routes)) {
    const source = rust(file);
    const start = source.indexOf(`pub async fn ${name.split('::')[1]}(`);
    assert.ok(start >= 0, `${name}: missing command`);
    const next = source.indexOf('#[tauri::command]', start);
    const body = source.slice(start, next < 0 ? undefined : next);
    assert.ok(body.includes(marker), `${name}: missing admission marker`);
    assert.ok(body.includes('renderer_admission::admit('), `${name}: missing limiter`);
    const limiter = body.indexOf('renderer_admission::admit(');
    for (const guard of guards[name] ?? []) {
      const position = body.indexOf(guard);
      assert.ok(
        position >= 0 && position < limiter,
        `${name}: guard must precede limiter: ${guard}`,
      );
    }
  }
  const studioGuard = rust('terminal_creation').split('fn studio_admission(')[1]?.split('\n}')[0];
  assert.ok(studioGuard);
  assert.ok(studioGuard.indexOf('if !focused') < studioGuard.indexOf('if !charge()'));
  assert.ok(studioGuard.indexOf('if !current') < studioGuard.indexOf('if !charge()'));
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
        .slice(terminal.indexOf('fn terminal_request_admission('))
        .split('_ => ')[0]
        ?.includes(`"${action}"`),
      action,
    );
  }
  const agents = rust('agents');
  for (const action of ['snapshot', 'retire', 'routing', 'start', 'delegate', 'stop']) {
    assert.ok(
      agents
        .slice(agents.indexOf('let action = match request["action"]'))
        .split('_ => ')[0]
        ?.includes(`"${action}"`),
      action,
    );
  }
});

test('closing actions bypass admission without removing native guards', () => {
  const terminal = rust('terminal');
  const agents = rust('agents');
  const terminalMap = terminal
    .split('fn terminal_request_admission(')
    .at(1)
    ?.split('_ => Err(())')[0];
  const agentsMap = agents
    .split('let action = match request["action"]')
    .at(1)
    ?.split('_ => return denied()')[0];
  assert.ok(terminalMap);
  assert.ok(agentsMap);
  assert.match(terminalMap, /Some\("stop" \| "detach"\) => Ok\(None\)/);
  assert.match(agentsMap, /Some\("stop" \| "retire"\) => None/);
  assert.match(terminal, /action != "hide"\s*&& !crate::renderer_admission::admit/);
  for (const source of [terminal, agents]) {
    assert.ok(source.includes('if let Some(action) = action'));
    assert.ok(source.includes('focus_required'));
    assert.ok(source.includes('revoked'));
  }
  assert.ok(terminal.includes('(document.0.as_str(), document.1)'));
  assert.ok(agents.includes('!= document'));
  assert.ok(!rust('renderer_admission').includes('Action::Stop'));
});

test('documented admission limits agree with native constants and action groups', () => {
  const source = rust('renderer_admission');
  const docs = readFileSync('docs/development/local-diagnostics.md', 'utf8');
  const constant = (name: string) => {
    const value = source.match(new RegExp(`const ${name}: u32 = (\\d+);`))?.[1];
    assert.ok(value, name);
    return value;
  };
  for (const [actions, limit] of [
    ['Catalog, Create, Selection, Open, Start, Navigate, File', constant('LIMIT')],
    ['Input, Read, Resize', constant('HIGH_FREQUENCY_LIMIT')],
    ['Control, Metadata, Permissions, Context, View', constant('CONTROL_LIMIT')],
  ]) {
    assert.match(docs, new RegExp(`\\| ${actions} +\\| +${limit} +\\|`));
  }
  assert.match(source, /Action::Input \| Action::Read \| Action::Resize => HIGH_FREQUENCY_LIMIT/);
  assert.match(source, /Action::Control[\s\S]*?Action::View => CONTROL_LIMIT/);
  assert.match(source, /_ => LIMIT/);
});
