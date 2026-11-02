import type { IpcMainInvokeEvent, Session, WebContents } from 'electron';
import { allowedNavigation, offlineURL } from './policy.js';

/** Object identity, not an origin supplied by a page, authorizes the IPC sender. */
export function authorizedArtifactSender(
  event: IpcMainInvokeEvent,
  expected: WebContents | undefined,
  session: Session,
  origin: string,
): boolean {
  try {
    const frame = event.senderFrame;
    return (
      !!expected &&
      !expected.isDestroyed() &&
      event.sender === expected &&
      expected.session === session &&
      !!frame &&
      !frame.detached &&
      !frame.isDestroyed() &&
      frame === expected.mainFrame &&
      frame.url === expected.getURL() &&
      frame.url !== offlineURL &&
      allowedNavigation(frame.url, origin)
    );
  } catch {
    return false;
  }
}
