import { modelAnalyticsQuerySchema, type ModelAnalyticsQuery } from '@orqst/protocol';
import type { serializeModelAnalytics } from '../../analytics-export.js';
export * from '../../analytics-export.js';

export function analyticsRequestQuery(request: string): ModelAnalyticsQuery {
  const params = new URL(request, location.origin).searchParams;
  const query: Record<string, unknown> = Object.fromEntries(params);
  if (query.unidentified === 'true') {
    delete query.unidentified;
    query.model = null;
  }
  return modelAnalyticsQuerySchema.parse(query);
}

export function downloadModelAnalytics(file: ReturnType<typeof serializeModelAnalytics>): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
  } finally {
    anchor.remove();
    // Allow the browser to consume the blob; retain no reusable content URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
