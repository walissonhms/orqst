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
  operationalOpen?: boolean;
  nativeAuthentication: boolean;
  scope: string;
  blocker?: string;
  terminalId?: string;
  translate(key: string): string;
}): string {
  const text = (key: string) => escapeHTML(options.translate(`managedTerminal.${key}`));
  const attribute = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const pair = options.providers.length >= 2;
  const slotName = (slot: number) => String.fromCharCode(65 + slot);
  const identity = escapeHTML(
    options.aliases?.[options.slot] ?? `T-${String(options.slot + 1).padStart(3, '0')}`,
  );
  const alias = `${slotName(options.slot)} · ${identity}`;
  const button = (id: string) =>
    `<button id="${id}"${id === 'login' && options.nativeAuthentication ? ' data-unavailable="true" disabled' : ''}>${text(id === 'start' && options.operationalOpen ? 'open' : id)}</button>`;
  const iconButton = (id: string, label: string, icon: string) =>
    `<button id="${id}" class="pane-icon" aria-label="${text(label)}" title="${text(label)}"${id === 'restore' ? ' hidden' : ''}><span aria-hidden="true">${icon}</span></button>`;
  return `<!doctype html>
<html lang="${escapeHTML(options.language)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${text('title')} ${alias} · ${escapeHTML(options.provider)}</title><link rel="stylesheet" href="${terminalStyleURL}"></head>
<body><main data-slot="${options.slot}" data-start-profile="${escapeHTML(options.startProfile)}"${options.operationalOpen ? ' data-operational-open="true"' : ''}>
<header class="pane-header">
  <span class="pane-provider">${escapeHTML(options.provider)}</span>
  <span class="pane-identity" title="${identity}">${identity}</span>
  <h1 id="pane-title" data-provider="${escapeHTML(options.provider)}" data-slot-name="${slotName(options.slot)}" title="${alias}" draggable="true">${slotName(options.slot)}</h1>
  <p id="lifecycle" class="lifecycle" ${['prepared', 'starting', 'running', 'exited', 'start_failed', 'ownership_lost'].map((state) => `data-${state}="${text(state)}" data-short-${state}="${text(`state_${state}`)}"`).join(' ')} title="${text('prepared')}">${text('state_prepared')}</p>
  <div class="pane-primary">${iconButton('hide-pane', 'minimize', '−')}${iconButton('maximize', 'maximize', '□')}${iconButton('restore', 'restore', '❐')}</div>
  <details id="pane-menu" class="pane-menu">
    <summary id="pane-menu-toggle" aria-label="${text('paneMenu')}" title="${text('paneMenu')}" aria-expanded="false"><span aria-hidden="true">⋯</span></summary>
    <div class="pane-menu-panel">
      <nav class="pane-navigation" aria-label="${text('navigation')}">
        <button id="dashboard">${text('dashboard')}</button>
        <div class="pane-tabs">${options.providers.map((provider, slot) => `<button id="tab-${String.fromCharCode(97 + slot)}" data-tab="${slot}" aria-pressed="${slot === options.slot}">${slotName(slot)} · ${escapeHTML(provider)}</button>`).join('')}</div>
      </nav>
      <details class="layout-options"><summary>${text('settingsLayout')}</summary>
        <nav aria-label="${text('layout')}">${['split-columns', 'split-rows', 'show-all', 'focus-other', 'move-earlier', 'move-later'].map((action) => `<button id="${action}"${!pair ? ' disabled' : ''}>${text(action)}</button>`).join('')}</nav>
        <label class="split-size">${text('splitSize')}<input id="split-size" type="range" min="25" max="75" step="1" value="50"${!pair ? ' disabled' : ''}><output id="split-value">50%</output></label>
        <label class="column-choice">${text('columns')} <select id="column-choice">${[0, 1, 2, 3].map((value) => `<option value="${value}"${value === 2 ? ' selected' : ''}>${value === 0 ? text('adaptive') : value}</option>`).join('')}</select></label>
        <form id="rename-pane"><label>${text('displayName')} <input id="pane-name" maxlength="48" required autocomplete="off"></label><button type="submit">${text('rename')}</button></form>
        <p id="layout-feedback" role="status" data-summary="${text('layoutSummary')}" data-memory="${text('layoutMemoryOnly')}"></p>
        <p class="muted">${text('layoutHelp')}</p>
        <p class="muted">${text('floatingUnavailable')}</p>
      </details>
      <div class="pane-actions" aria-label="${text('paneActions')}">
        <div class="pane-view-actions" role="group" aria-label="${text('viewGroup')}">
          <p class="muted">${text('viewGroupHelp')}</p>
          <button id="hide-pane">${text('hideView')}</button>${button('detach')}
        </div>
        <div class="pane-process-actions" role="group" aria-label="${text('processGroup')}">
          <p class="muted">${text('processGroupHelp')}</p>
          ${button('stop')}${button('kill')}
        </div>
      </div>
      <details class="session-details"><summary>${text('details')}</summary>
        <p class="project"><span>${text('projectLabel')}</span> <bdi>${escapeHTML(options.project)}</bdi></p>
        <p>${text(options.scope)}</p><p>${text('cliVersion')}: ${escapeHTML(options.version)}</p>
        <p>${text('aliasScope')}</p>
        <p>${text('terminalIdentity')}: <code id="terminal-identity">${escapeHTML(options.terminalId ?? '—')}</code></p>
        <p>${text('identity')}: <code id="instance">—</code></p>
        <p>${text('permissionHelp')}</p><p>${text('hideHelp')}</p>
        <p>${text('forceStopHelp')}</p>${button('login')}
      </details>
    </div>
  </details>
</header>
<section class="process-controls" aria-label="${text('processControls')}">
  <div class="action-row">${['start', 'attach', 'input'].map(button).join('')}</div>
  <p id="guidance" class="guidance" ${['blocked', 'start', 'attach', 'input', 'typing', 'exited', 'uncertain', 'gap', 'openingIncomplete'].map((key) => `data-${attribute(key)}="${text(`guide_${key}`)}"`).join(' ')}>${text(options.blocker ? 'guide_blocked' : 'guide_start')}</p>
</section>
<p id="status" data-blocked="${options.blocker ? 'true' : 'false'}" role="status" aria-live="polite" data-authorization="${text('authorization')}" ${['idle', 'denied', 'cancelled', 'busy', 'ok', 'gap', 'revoked', 'focus_required', 'unavailable', 'openingIncomplete'].map((key) => `data-${attribute(key)}="${text(key)}"`).join(' ')}>${text(options.blocker ?? (options.nativeAuthentication ? 'reuseIdle' : 'idle'))}</p>
<div id="terminal" data-keyboard="${text('keyboard')}" data-toomuch="${text('tooMuch')}" aria-label="${text('output')}"></div>
</main><script src="${terminalScriptURL}" defer></script></body></html>`;
}
