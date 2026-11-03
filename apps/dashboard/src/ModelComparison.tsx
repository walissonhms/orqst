import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelAnalyticsSummary } from '@orqst/protocol';

// The parent mounts this view only for one current, validated aggregate reading.
export function ModelComparison({ data }: { data: ModelAnalyticsSummary }) {
  const { t, i18n } = useTranslation();
  const [selection, setSelection] = useState(['', '', '']);
  const options = data.models.map((row) => ({
    id: JSON.stringify([row.adapter, row.model]),
    row,
  }));
  const selected = selection.flatMap((id) => {
    const option = options.find((item) => item.id === id);
    return option ? [option] : [];
  });
  const number = (value: number | null | undefined) =>
    value == null ? t('unknown') : new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
  const metrics = [
    ['analytics.reportedTokens', (row) => row.usage?.total],
    ['input', (row) => row.usage?.input],
    ['output', (row) => row.usage?.output],
    ['cached', (row) => row.usage?.cached],
    ['sessions', (row) => row.sessions],
  ] satisfies [string, (row: ModelAnalyticsSummary['models'][number]) => number | undefined][];
  return (
    <section className="panel analytics-comparison" aria-labelledby="model-comparison-title">
      <h2 id="model-comparison-title">{t('analytics.comparison.title')}</h2>
      <p className="notice">{t('analytics.comparison.limits')}</p>
      <p className="fine-print">{t('analytics.comparison.scope')}</p>
      <div className="analytics-filters">
        {selection.map((id, index) => (
          <label key={index}>
            {t('analytics.comparison.slot', { number: index + 1 })}
            <select
              value={id}
              onChange={(event) =>
                setSelection((current) =>
                  current.map((value, slot) => (slot === index ? event.target.value : value)),
                )
              }
            >
              <option value="">{t('analytics.comparison.choose')}</option>
              {options.map((option) => (
                <option
                  key={option.id}
                  value={option.id}
                  disabled={option.id !== id && selection.includes(option.id)}
                >
                  {option.row.adapter}: {option.row.model ?? t('analytics.unidentified')}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {selected.length < 2 ? (
        <p className="fine-print">{t('analytics.comparison.minimum')}</p>
      ) : (
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label={t('analytics.comparison.table')}
        >
          <table className="analytics-comparison-table">
            <caption className="sr-only">{t('analytics.comparison.table')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('analytics.comparison.metric')}</th>
                {selected.map(({ id, row }) => (
                  <th scope="col" key={id}>
                    <span className="analytics-model">
                      {row.model ?? t('analytics.unidentified')}
                    </span>
                    <small className="analytics-provider">{row.adapter}</small>
                    <small className="analytics-provider">
                      {t('analytics.providerUnavailable')}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map(([label, value]) => (
                <tr key={label}>
                  <th scope="row">{t(label)}</th>
                  {selected.map(({ id, row }) => (
                    <td key={id} className="mono">
                      {number(value(row))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="fine-print">{t('analytics.nonAdditive')}</p>
      <p className="fine-print">{t('analytics.cache')}</p>
      <p className="fine-print">{t('analytics.comparison.unavailable')}</p>
    </section>
  );
}
