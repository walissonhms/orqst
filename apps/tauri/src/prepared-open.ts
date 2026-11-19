/** One bounded wait for a native intent to become dispatchable. A real attempt is final. */
export async function awaitPreparedOpen<T>(
  open: () => Promise<{ attempted: boolean; value?: T }>,
  pause: () => Promise<void>,
  active: () => boolean,
) {
  for (let i = 0; i < 12 && active(); i++) {
    const reply = await open();
    if (reply.attempted) return reply.value;
    if (i < 11 && active()) await pause();
  }
  return undefined;
}
