import { DatabaseSync } from 'node:sqlite';
import { featureScopeSchema } from '@orqst/protocol';

/** Trusted native database path only. No Store construction, migrations or write pragmas. */
export function readTerminalWorkspace(file: string, workspaceId: string): string {
  featureScopeSchema.shape.workspaceId.parse(workspaceId);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');
    const row = db.prepare('SELECT path FROM workspaces WHERE id=? LIMIT 1').get(workspaceId);
    if (typeof row?.path !== 'string' || row.path.length > 2048)
      throw new Error('Selected workspace unavailable');
    return row.path;
  } finally {
    db.close();
  }
}
