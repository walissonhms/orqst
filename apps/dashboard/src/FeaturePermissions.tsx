import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FeatureNativeSnapshot, WorkspaceFeature } from '@orqst/protocol';
import {
  permissionConfiguration,
  permissionProblems,
  permissionRules,
  permissionTerminals,
  toggleOperation,
  type PermissionOperation,
  type PermissionRule,
} from './feature-permissions-matrix.js';

const OPERATIONS: PermissionOperation[] = ['delegate', 'execute', 'view'];

/** Feature-level policy panel. The renderer only proposes; the native review is the write gate. */
type FeaturePermissionsProps = {
  snapshot?: FeatureNativeSnapshot;
  feature?: WorkspaceFeature;
};

export function FeaturePermissions(props: FeaturePermissionsProps) {
  return <FeaturePermissionsPanel key={props.feature?.featureId ?? 'none'} {...props} />;
}

function FeaturePermissionsPanel({ snapshot, feature }: FeaturePermissionsProps) {
  const { t } = useTranslation();
  const native = typeof window === 'undefined' ? undefined : window.orqstFeaturePermissions;
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [revision, setRevision] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [readVersion, setReadVersion] = useState(0);
  const terminals = permissionTerminals(snapshot, feature?.featureId ?? null);
  const problems = permissionProblems(rules);
  useEffect(() => {
    if (!native || !feature) return;
    let live = true;
    setBusy(true);
    void native
      .read(feature.featureId)
      .then((reply) => {
        if (!live) return;
        if (!reply.permissions) {
          setNotice(reply.status === 'ok' ? 'unavailable' : reply.status);
          return;
        }
        setRevision(reply.permissions.revision);
        setRules(permissionRules(reply.permissions.configuration));
        setNotice('');
      })
      .catch(() => {
        if (live) setNotice('unavailable');
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [native, feature?.featureId, readVersion]);
  const operation = (source: string, target: string, op: PermissionOperation) =>
    rules
      .find((rule) => rule.sourceTerminalId === source && rule.targetTerminalId === target)
      ?.operations.includes(op) ?? false;
  async function propose() {
    if (!native || !feature || revision === null || busy || problems.length) return;
    setBusy(true);
    setNotice('');
    try {
      const reply = await native.propose({
        featureId: feature.featureId,
        expectedRevision: revision,
        configuration: permissionConfiguration(rules),
      });
      if (reply.permissions) {
        setRevision(reply.permissions.revision);
        setRules(permissionRules(reply.permissions.configuration));
      }
      if (reply.status === 'unknown') setRevision(null);
      if (reply.status !== 'ok') setNotice(reply.status);
    } catch {
      setRevision(null);
      setNotice('unknown');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="feature-permissions" aria-labelledby="feature-permissions-title">
      <div className="feature-permissions-head">
        <h3 id="feature-permissions-title">{t('features.permissions.title')}</h3>
        <span className="muted">
          {t('features.permissions.revision', { revision: revision ?? 0 })}
        </span>
      </div>
      <p className="muted">{t('features.permissions.help')}</p>
      {revision === 0 && (
        <p className="notice" role="status">
          {t('features.permissions.defaultState')}
        </p>
      )}
      {terminals.length === 0 ? (
        <p className="muted">{t('features.permissions.empty')}</p>
      ) : (
        <table className="feature-permissions-matrix">
          <thead>
            <tr>
              <th scope="col">{t('features.permissions.source')}</th>
              {terminals.map((target) => (
                <th key={target.terminalId} scope="col">
                  {target.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {terminals.map((source) => (
              <tr key={source.terminalId}>
                <th scope="row">{source.label}</th>
                {terminals.map((target) => (
                  <td key={target.terminalId}>
                    {source.terminalId === target.terminalId ? (
                      <span className="muted">{t('features.permissions.selfBlocked')}</span>
                    ) : (
                      OPERATIONS.map((op) => (
                        <label key={op} className="feature-permissions-toggle">
                          <input
                            type="checkbox"
                            checked={operation(source.terminalId, target.terminalId, op)}
                            disabled={busy}
                            onChange={() =>
                              setRules((value) =>
                                toggleOperation(value, source.terminalId, target.terminalId, op),
                              )
                            }
                          />
                          {t(`features.permissions.${op}`)}
                        </label>
                      ))
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {problems.length > 0 && (
        <p className="notice" role="alert">
          {t('features.permissions.invalid')}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {t(`features.permissions.${notice}`)}
        </p>
      )}
      <button
        type="button"
        className="button primary"
        disabled={!native || !feature || revision === null || busy || problems.length > 0}
        onClick={() => void propose()}
      >
        {t('features.permissions.propose')}
      </button>
      <button
        type="button"
        className="button"
        disabled={!native || !feature || busy}
        onClick={() => {
          setRevision(null);
          setNotice('');
          setReadVersion((version) => version + 1);
        }}
      >
        {t('features.permissions.refresh')}
      </button>
    </section>
  );
}
