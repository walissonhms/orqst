/** A request notice is transient: a newer authoritative snapshot resolves it. */
export function featureNoticeAfterSnapshot(
  notice: string,
  noticeGeneration: number,
  incomingGeneration: number,
) {
  return incomingGeneration > noticeGeneration ? '' : notice;
}
