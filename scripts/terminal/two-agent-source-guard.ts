// Explicit acceptance only: inspect names/metadata, never captured content or credentials.
import assert from 'node:assert/strict';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function metadata(file: string): string | null {
  try {
    const info = lstatSync(file);
    assert.ok(info.isFile() && !info.isSymbolicLink(), 'Unsafe native history path');
    return `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Concurrent history writes are inconclusive and fail acceptance; never stop other sessions. */
export function acceptanceSourceGuard(codexHomes: readonly string[]) {
  const homes = [...new Set(codexHomes)];
  const history = homes.map((home) => metadata(join(home, 'history.jsonl')));
  return (threadIds: readonly string[]) => {
    assert.ok(threadIds.length > 0 && threadIds.every((id) => /^[a-zA-Z0-9_-]+$/.test(id)));
    let entries = 0;
    const inspect = (directory: string, depth: number) => {
      assert.ok(depth <= 8, 'Native source inspection depth exceeded');
      let info;
      try {
        info = lstatSync(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Unsafe native source directory');
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        assert.ok(++entries <= 100000, 'Native source inspection budget exceeded');
        assert.ok(!entry.isSymbolicLink(), 'Native source symlink inspection denied');
        assert.ok(
          !threadIds.some((id) => entry.name.includes(id)),
          'Acceptance thread materialized in a native session source',
        );
        if (entry.isDirectory()) inspect(join(directory, entry.name), depth + 1);
      }
    };
    homes.forEach((home, index) => {
      assert.equal(
        metadata(join(home, 'history.jsonl')),
        history[index],
        'Native history metadata changed; acceptance is inconclusive',
      );
      inspect(join(home, 'sessions'), 0);
      inspect(join(home, 'archived_sessions'), 0);
    });
  };
}
