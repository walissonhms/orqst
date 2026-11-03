import { terminalDocumentURL } from './terminal-sender.js';

export const terminalScriptURL = 'orqst-terminal://local/client.js';
export const terminalStyleURL = 'orqst-terminal://local/style.css';

/** Separate session and allowlist; never extend the dashboard's network/control authority. */
export function allowedTerminalRequest(url: string, resourceType: string): boolean {
  return (
    (resourceType === 'mainFrame' && url === terminalDocumentURL) ||
    (resourceType === 'script' && url === terminalScriptURL) ||
    (resourceType === 'stylesheet' && url === terminalStyleURL)
  );
}

export const terminalContentSecurityPolicy =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; " +
  "img-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; " +
  "form-action 'none'; frame-ancestors 'none'";
