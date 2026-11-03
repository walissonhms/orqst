import type { BrowserWindow, IpcMainInvokeEvent, Session, WebFrameMain } from 'electron';

// Reserved dedicated document. The observer window must never qualify as a terminal client.
export const terminalDocumentURL = 'orqst-terminal://local/index.html';
export interface TerminalDocumentBinding {
  readonly frame: WebFrameMain;
  readonly generation: number;
}

/** Fail closed on subframes, navigation/reload, another session/window and lost native focus. */
export function authorizedTerminalSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow,
  session: Session,
  binding: TerminalDocumentBinding,
  currentGeneration: number,
  requireFocus: boolean,
): boolean {
  try {
    const contents = window.webContents;
    const document = binding.frame;
    return (
      binding.generation === currentGeneration &&
      !window.isDestroyed() &&
      !contents.isDestroyed() &&
      event.sender === contents &&
      contents.session === session &&
      !document.detached &&
      !document.isDestroyed() &&
      event.senderFrame === document &&
      contents.mainFrame === document &&
      document.url === terminalDocumentURL &&
      contents.getURL() === terminalDocumentURL &&
      (!requireFocus || (window.isFocused() && contents.isFocused()))
    );
  } catch {
    return false;
  }
}
