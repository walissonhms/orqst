import type { BrowserWindow, WebContents } from 'electron';

export interface NativeTerminalClient {
  revokeInput(): void;
  close(): void;
}

/** Opt-in wiring for one dedicated native document, including a sibling terminal view. */
export function bindTerminalNativeLifecycle(
  window: BrowserWindow,
  client: NativeTerminalClient,
  contents: WebContents = window.webContents,
): () => void {
  const blur = () => client.revokeInput();
  const close = () => client.close();
  const navigate = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => {
    if (mainFrame) close();
  };
  window.on('blur', blur);
  window.on('hide', blur);
  contents.on('blur', blur);
  window.on('closed', close);
  contents.on('did-start-navigation', navigate);
  contents.on('render-process-gone', close);
  contents.on('destroyed', close);
  return () => {
    close();
    window.removeListener('blur', blur);
    window.removeListener('hide', blur);
    contents.removeListener('blur', blur);
    window.removeListener('closed', close);
    contents.removeListener('did-start-navigation', navigate);
    contents.removeListener('render-process-gone', close);
    contents.removeListener('destroyed', close);
  };
}
