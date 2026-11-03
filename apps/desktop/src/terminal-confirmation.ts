import type { BrowserWindow, Dialog } from 'electron';
import type { TerminalNativeConfirmation } from '@orqst/protocol';

/** Small native dialog only; larger paste review needs a separate trusted, scrolling surface. */
export async function confirmTerminalAction(
  dialog: Pick<Dialog, 'showMessageBox'>,
  window: BrowserWindow,
  translate: (key: string) => string,
  details: TerminalNativeConfirmation,
): Promise<boolean> {
  // JSON quoting exposes control characters. Escape directional/format controls too.
  const detail = JSON.stringify(details, null, 2).replace(
    /\p{Cf}/gu,
    (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
  );
  // Refuse rather than ask the user to approve a truncated or very long manifest.
  if (detail.length > 4096 || (details.paste !== undefined && details.paste.length > 1024))
    return false;
  const result = await dialog.showMessageBox(window, {
    type: 'warning',
    title: translate('terminalNative.title'),
    message: translate(`terminalNative.${details.operation}`),
    detail,
    buttons: [translate('terminalNative.cancel'), translate('terminalNative.confirm')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}
