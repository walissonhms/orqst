import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, Session } from 'electron';
import { terminalNativeReplySchema, terminalNativeRequestSchema } from '@orqst/protocol';
import type { TerminalNativeReply } from '../../../packages/core/src/terminal/native-broker.js';
import { authorizedTerminalSender, type TerminalDocumentBinding } from './terminal-sender.js';
import { bindTerminalNativeLifecycle } from './terminal-lifecycle.js';

interface Broker {
  dispatch(document: TerminalDocumentBinding, request: unknown): Promise<TerminalNativeReply>;
  revokeInput(): void;
  close(): void;
}

/** One dedicated window/document; reload permanently closes it. No recovery/adoption shortcut. */
export function bindTerminalRuntime(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
  window: BrowserWindow,
  session: Session,
  create: (document: TerminalDocumentBinding, current: (focus: boolean) => boolean) => Broker,
): () => void {
  let generation = 0;
  let initialized = false;
  let disposed = false;
  let binding: TerminalDocumentBinding | undefined;
  let broker: Broker | undefined;
  let active: IpcMainInvokeEvent | undefined;
  let busy = false;
  const current = (focus: boolean) =>
    !disposed &&
    !!binding &&
    !!active &&
    authorizedTerminalSender(active, window, session, binding, generation, focus);
  const navigate = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => {
    if (!mainFrame) return;
    generation++;
    broker?.close();
  };
  const initialize = () => {
    if (initialized || disposed || window.isDestroyed()) return;
    initialized = true;
    binding = Object.freeze({ frame: window.webContents.mainFrame, generation });
    // Sender validation below still rejects any initial URL except the reserved document.
    broker = create(binding, current);
  };
  const client = {
    revokeInput: () => broker?.revokeInput(),
    close: () => broker?.close(),
  };
  const unbind = bindTerminalNativeLifecycle(window, client);
  window.webContents.on('did-start-navigation', navigate);
  window.webContents.on('did-finish-load', initialize);
  ipc.handle('orqst:terminal-native', async (event, raw: unknown) => {
    // Reject identity and shape before reserving state; never retain a request queue.
    if (
      disposed ||
      !binding ||
      !broker ||
      !authorizedTerminalSender(event, window, session, binding, generation, false) ||
      !terminalNativeRequestSchema.safeParse(raw).success
    )
      return { status: 'denied' };
    if (busy) return { status: 'busy' };
    busy = true;
    active = event;
    try {
      const reply = await broker.dispatch(binding, raw);
      if (!current(false)) return { status: 'denied' };
      if (reply.status === 'ok' && reply.output && reply.output.bytes.byteLength > 64 * 1024)
        return { status: 'denied' };
      // Serialize only a strict, bounded public reply. Uint8Array does not expose Buffer internals.
      const wire = {
        ...reply,
        ...(reply.status === 'ok' && reply.output
          ? { output: { ...reply.output, bytes: Array.from(reply.output.bytes) } }
          : {}),
      };
      const parsed = terminalNativeReplySchema.safeParse(wire);
      return parsed.success ? parsed.data : { status: 'denied' };
    } catch {
      return { status: 'denied' };
    } finally {
      active = undefined;
      busy = false;
    }
  });
  return () => {
    if (disposed) return;
    disposed = true;
    unbind();
    active = undefined;
    ipc.removeHandler('orqst:terminal-native');
    window.webContents.removeListener('did-start-navigation', navigate);
    window.webContents.removeListener('did-finish-load', initialize);
  };
}
