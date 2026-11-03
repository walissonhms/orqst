import { parentPort, workerData } from 'node:worker_threads';
import {
  AnalyticsReadCapacityError,
  readModelAnalyticsSummary,
  readModelAnalyticsEvolution,
} from '@orqst/database';
import type { ModelAnalyticsQuery } from '@orqst/protocol';

const { file, query, projection } = workerData as {
  file: string;
  query: ModelAnalyticsQuery;
  projection?: 'summary' | 'evolution';
};
try {
  const report =
    projection === 'evolution'
      ? readModelAnalyticsEvolution(file, query)
      : readModelAnalyticsSummary(file, query);
  parentPort!.postMessage({ report });
} catch (error) {
  // Never expose SQLite diagnostics, paths or captured evidence to the observer/API.
  parentPort!.postMessage({
    error:
      error instanceof AnalyticsReadCapacityError
        ? 'analytics_capacity_exceeded'
        : 'analytics_unavailable',
  });
} finally {
  parentPort!.close();
}
