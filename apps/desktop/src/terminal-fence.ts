/** During a shutdown fence only revocation, suspension and approved reads are applied. */
export function visualAllowedDuringFence(kind: string) {
  return kind === 'layout-generation' || kind === 'layout-suspend';
}
