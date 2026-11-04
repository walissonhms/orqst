import { escapeHTML } from './policy.js';
import { terminalScriptURL, terminalStyleURL } from './terminal-policy.js';

/** Trusted native chrome only. Provider output never supplies labels or markup. */
export function terminalDocument(options: {
  language: string;
  slot: number;
  providers: string[];
  aliases?: Array<string | undefined>;
  provider: string;
  project: string;
  version: string;
  startProfile: string;
  nativeAuthentication: boolean;
  scope: string;
  blocker?: string;
  terminalId?: string;
  translate(key: string): string;
}): string {
  const text = (key: string) => escapeHTML(options.translate(`managedTerminal.${key}`));
  const pair = options.providers.length >= 2;
  const slotName = (slot: number) => String.fromCharCode(65 + slot);
  const alias = escapeHTML(
    `${slotName(options.slot)} · ${options.aliases?.[options.slot] ?? `T-${String(options.slot + 1).padStart(3, '0')}`}`,
  );
  const button = (id: string) =>
    `<button id="${id}"${id === 'login' && options.nativeAuthentication ? ' data-unavailable="true" disabled' : ''}>${text(id)}</button>`;
  return `<!doctype html>
<html lang="${escapeHTML(options.language)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${text('title')} ${alias} · ${escapeHTML(options.provider)}</title><link rel="stylesheet" href="${terminalStyleURL}"></head>
<body><main data-start-profile="${escapeHTML(options.startProfile)}">
<header class="pane-header">
  <div class="pane-heading"><span class="eyebrow">${text('studioLabel')}</span><h1 title="${alias}">${slotName(options.slot)} · ${escapeHTML(options.provider)}</h1></div>
  <p id="lifecycle" class="lifecycle" ${['prepared', 'starting', 'running', 'exited', 'start_failed', 'ownership_lost'].map((state) => `data-${state}="${text(state)}"`).join(' ')}>${text('prepared')}</p>
</header>
<p class="project" title="${escapeHTML(options.project)}"><span>${text('projectLabel')}</span> <bdi>${escapeHTML(options.project)}</bdi></p>
<nav class="pane-navigation" aria-label="${text('navigation')}">
  <div class="pane-tabs">${options.providers.map((provider, slot) => `<button id="tab-${String.fromCharCode(97 + slot)}" data-tab="${slot}" aria-pressed="${slot === options.slot}">${slotName(slot)} · ${escapeHTML(provider)}</button>`).join('')}</div>
  <button id="dashboard">${text('dashboard')}</button><button id="hide-pane" title="${text('hideHelp')}">${text('hidePane')}</button>
</nav>
<div class="layout-toolbar"><nav aria-label="${text('layout')}">${['split-columns', 'split-rows'].map((action) => `<button id="${action}"${!pair ? ' disabled' : ''}>${text(action)}</button>`).join('')}</nav>
<details class="layout-options"><summary>${text('layout')}</summary>
  <nav aria-label="${text('layout')}">${['maximize', 'restore', 'focus-other'].map((action) => `<button id="${action}"${!pair && action !== 'maximize' ? ' disabled' : ''}>${text(action)}</button>`).join('')}
  <label class="split-size">${text('splitSize')}<input id="split-size" type="range" min="25" max="75" step="1" value="50"${!pair ? ' disabled' : ''}><output id="split-value">50%</output></label></nav>
  <p class="muted">${text('layoutHelp')}</p>
</details></div>
<section class="process-controls" aria-label="${text('processControls')}">
  <div class="action-row">${['start', 'attach', 'input', 'detach', 'stop'].map(button).join('')}</div>
  <p id="guidance" class="guidance" ${['blocked', 'start', 'attach', 'input', 'typing', 'exited', 'uncertain', 'gap'].map((key) => `data-${key}="${text(`guide_${key}`)}"`).join(' ')}>${text(options.blocker ? 'guide_blocked' : 'guide_start')}</p>
</section>
<p id="status" data-blocked="${options.blocker ? 'true' : 'false'}" role="status" aria-live="polite" ${['idle', 'denied', 'cancelled', 'busy', 'ok', 'gap', 'revoked', 'focus_required'].map((key) => `data-${key}="${text(key)}"`).join(' ')}>${text(options.blocker ?? (options.nativeAuthentication ? 'reuseIdle' : 'idle'))}</p>
<div id="terminal" data-keyboard="${text('keyboard')}" data-toomuch="${text('tooMuch')}" aria-label="${text('output')}"></div>
<details class="session-details"><summary>${text('details')}</summary>
  <p>${text(options.scope)}</p><p>${text('cliVersion')}: ${escapeHTML(options.version)}</p>
  <p>${text('aliasScope')}</p>
  <p>${text('terminalIdentity')}: <code id="terminal-identity">${escapeHTML(options.terminalId ?? '—')}</code></p>
  <p>${text('identity')}: <code id="instance">—</code></p>
  <p>${text('permissionHelp')}</p>
  <p>${text('hideHelp')}</p>
  <p>${text('forceStopHelp')}</p>${button('kill')}${button('login')}
</details>
</main><script src="${terminalScriptURL}" defer></script></body></html>`;
}
