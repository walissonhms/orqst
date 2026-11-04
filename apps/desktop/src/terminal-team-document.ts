import { escapeHTML } from './policy.js';

/** Shared native-client editor surface; all user-authored values are assigned via DOM properties. */
export function terminalTeamDocument(translate: (key: string) => string, review = false): string {
  const keys = [
    'title',
    'help',
    'name',
    'memberName',
    'handle',
    'role',
    'worker',
    'reviewer',
    'orchestrator',
    'targets',
    'save',
    'reload',
    'review',
    'saved',
    'unavailable',
    'working',
    'defaultName',
  ];
  return `<details><summary>${escapeHTML(translate('terminalTeam.title'))}</summary><section id="terminal-team" ${keys.map((key) => `data-${key.toLowerCase()}="${escapeHTML(translate(`terminalTeam.${key === 'help' && !review ? 'ptyHelp' : key}`))}"`).join(' ')}></section></details>`;
}
