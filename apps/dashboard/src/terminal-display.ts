import {
  terminalDisplayId as formatTerminalDisplayId,
  type WorkspaceFeature,
} from '@orqst/protocol';

export function terminalDisplayId(
  feature: WorkspaceFeature | undefined,
  terminalId: string,
  legacySlot: number,
): string;
export function terminalDisplayId(
  feature: WorkspaceFeature | undefined,
  terminalId: string,
  legacySlot?: number,
): string | undefined;
/** Use the persisted Feature identity. Slot numbers only label legacy or unassigned terminals. */
export function terminalDisplayId(
  feature: WorkspaceFeature | undefined,
  terminalId: string,
  legacySlot?: number,
) {
  return (
    feature?.terminalDisplays?.find((display) => display.terminalId === terminalId)?.displayId ??
    (legacySlot === undefined ? undefined : formatTerminalDisplayId(legacySlot + 1))
  );
}
