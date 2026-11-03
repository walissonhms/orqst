import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
  Session,
  WebContents,
  WebFrameMain,
} from 'electron';
import { terminalNativeReplySchema, terminalNativeRequestSchema } from '@orqst/protocol';
import type { TerminalNativeReply } from '../../../packages/core/src/terminal/native-broker.js';
import { authorizedTerminalSender, type TerminalDocumentBinding } from './terminal-sender.js';
import { bindTerminalNativeLifecycle } from './terminal-lifecycle.js';

export interface TerminalSurface {
  contents: WebContents;
  visible(): boolean;
}

interface Broker {
  dispatch(document: TerminalDocumentBinding, request: unknown): Promise<TerminalNativeReply>;
  revokeInput(): void;
  close(): void;
}

type Dispatch = (event: IpcMainInvokeEvent, raw: unknown) => Promise<unknown>;
type CreateBroker = (
  document: TerminalDocumentBinding,
  current: (focus: boolean) => boolean,
) => Broker;

/** One IPC handler; routing authority is the native frame, never a renderer-supplied slot. */
export function createTerminalRuntimeRouter(ipc: Pick<IpcMain, 'handle' | 'removeHandler'>) {
  const documents = new Map<WebFrameMain, Dispatch>();
  const bindings = new Set<() => void>();
  let closed = false;
  ipc.handle(
    'orqst:terminal-native',
    (event, raw: unknown) =>
      documents.get(event.senderFrame!)?.(event, raw) ?? { status: 'denied' },
  );
  return {
    bind(window: BrowserWindow, session: Session, create: CreateBroker, surface?: TerminalSurface) {
      if (closed || bindings.size >= 2) throw new Error('Terminal document capacity exceeded');
      const dispose = bindRuntime(
        window,
        session,
        create,
        (frame, dispatch) => {
          if (documents.has(frame)) throw new Error('Terminal document already bound');
          documents.set(frame, dispatch);
          return () => documents.delete(frame);
        },
        surface,
      );
      const unbind = () => {
        dispose();
        bindings.delete(unbind);
      };
      bindings.add(unbind);
      return unbind;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const dispose of [...bindings]) dispose();
      documents.clear();
      ipc.removeHandler('orqst:terminal-native');
    },
  };
}

/** One dedicated native document; reload permanently closes it. No recovery/adoption shortcut. */
export function bindTerminalRuntime(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
  window: BrowserWindow,
  session: Session,
  create: CreateBroker,
): () => void {
  const router = createTerminalRuntimeRouter(ipc);
  router.bind(window, session, create);
  return () => router.close();
}

function bindRuntime(
  window: BrowserWindow,
  session: Session,
  create: CreateBroker,
  register: (frame: WebFrameMain, dispatch: Dispatch) => () => void,
  surface?: TerminalSurface,
): () => void {
  const contents = surface?.contents ?? window.webContents;
  const visible = () => surface?.visible() ?? true;
  let generation = 0;
  let initialized = false;
  let disposed = false;
  let binding: TerminalDocumentBinding | undefined;
  let broker: Broker | undefined;
  let active: IpcMainInvokeEvent | undefined;
  let busy = false;
  let unregister: (() => void) | undefined;
  const current = (focus: boolean) =>
    !disposed &&
    !!binding &&
    !!active &&
    authorizedTerminalSender(
      active,
      window,
      session,
      binding,
      generation,
      focus,
      contents,
      visible(),
    );
  const navigate = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => {
    if (!mainFrame) return;
    generation++;
    unregister?.();
    broker?.close();
  };
  const initialize = () => {
    if (initialized || disposed || window.isDestroyed()) return;
    initialized = true;
    binding = Object.freeze({ frame: contents.mainFrame, generation });
    // Sender validation below still rejects any initial URL except the reserved document.
    broker = create(binding, current);
    unregister = register(binding.frame, dispatch);
  };
  const client = {
    revokeInput: () => broker?.revokeInput(),
    close: () => broker?.close(),
  };
  const unbind = bindTerminalNativeLifecycle(window, client, contents);
  contents.on('did-start-navigation', navigate);
  contents.on('did-finish-load', initialize);
  const dispatch: Dispatch = async (event, raw: unknown) => {
    // Reject identity and shape before reserving state; never retain a request queue.
    if (
      disposed ||
      !binding ||
      !broker ||
      !authorizedTerminalSender(
        event,
        window,
        session,
        binding,
        generation,
        false,
        contents,
        visible(),
      )
    )
      return { status: 'denied' };
    const parsedRequest = terminalNativeRequestSchema.safeParse(raw);
    if (!parsedRequest.success) return { status: 'denied' };
    if (
      ['start', 'attach', 'input', 'paste', 'write', 'stop'].includes(parsedRequest.data.action) &&
      !authorizedTerminalSender(
        event,
        window,
        session,
        binding,
        generation,
        true,
        contents,
        visible(),
      )
    )
      return { status: 'focus_required' };
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
  };
  return () => {
    if (disposed) return;
    disposed = true;
    unbind();
    active = undefined;
    unregister?.();
    contents.removeListener('did-start-navigation', navigate);
    contents.removeListener('did-finish-load', initialize);
  };
}
