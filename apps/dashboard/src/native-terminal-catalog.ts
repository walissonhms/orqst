import type { TerminalPreparationCatalog } from '@orqst/protocol';
import type { ProviderCatalog, TerminalRequest } from './NewTerminalDialog.js';

type Entry = TerminalPreparationCatalog['providers'][number];

/** Map the native catalog to the dialog; only confirmed providers and models appear. */
export function dialogCatalog(catalog: TerminalPreparationCatalog): ProviderCatalog[] {
  return catalog.providers.map((entry) => ({
    provider: entry.provider,
    available: entry.status === 'available',
    models: entry.models
      .filter((model) => model.source !== 'cli-default')
      .map((model) => ({ id: model.id, label: model.label })),
  }));
}

/** `null` in the dialog means the CLI's own default: use the catalog's CLI-default entry. */
export function catalogModelId(entry: Entry | undefined, model: string | null): string | null {
  if (!entry) return null;
  if (model !== null) return entry.models.some((m) => m.id === model) ? model : null;
  return (
    (
      entry.models.find((m) => m.source === 'cli-default') ??
      entry.models.find((m) => m.isDefault) ??
      entry.models[0]
    )?.id ?? null
  );
}

/** Group equal provider+model requests so each group is one native `create-selected`. */
export function groupRequests(requests: TerminalRequest[]) {
  const groups = new Map<
    string,
    { provider: TerminalRequest['provider']; model: string | null; count: number }
  >();
  for (const request of requests) {
    const key = `${request.provider}:${request.model ?? ''}`;
    const group = groups.get(key) ?? { provider: request.provider, model: request.model, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()];
}
