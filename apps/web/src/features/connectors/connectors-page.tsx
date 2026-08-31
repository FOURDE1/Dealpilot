import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import {
  ConnectorField,
  ConsentChannel,
  ConsentScope,
  ConsentType,
  LeadSource,
  type CreateConnectorInputT,
  type TenantConnectorT,
} from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations } from '../organizations/api.js';
import { LEAD_SOURCE_KEYS } from '../leads/labels.js';
import { useConnectors, useCreateConnector, useDeleteConnector, useUpdateConnector } from './api.js';

/**
 * F-49 — the connector registry (FR-LEAD-019, leads.md §2.3, D-053).
 *
 * "Adding a new lead provider means registering a connector + mapping from
 * the admin console — no code change, no deploy." This is that console.
 * Each mapping row pairs a canonical field with the provider's own paths
 * (comma-separated; the first that yields a value wins), and the consent
 * section records what THAT form's checkbox actually granted — a fact about
 * the form, not about us. The API refuses built-in keys, ghost references
 * and in-use deletions; this screen shows those refusals, never hides them.
 */

type FieldKey = (typeof ConnectorField.options)[number];

const EMPTY_PATHS: Record<FieldKey, string> = {
  first_name: '', last_name: '', email: '', phone: '',
  vehicle_interest: '', preferred_language: '', comments: '',
};

export function ConnectorsPage() {
  const { t } = useTranslation('connectors');
  const { t: tLeads } = useTranslation('leads');
  const { t: tCommon } = useTranslation('common');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;

  const connectors = useConnectors(orgId, { enabled: orgId !== undefined });
  const createConnector = useCreateConnector();
  const updateConnector = useUpdateConnector();
  const deleteConnector = useDeleteConnector();

  const [sourceKey, setSourceKey] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<'json_webhook' | 'adf_xml'>('json_webhook');
  const [defaultSource, setDefaultSource] = useState<CreateConnectorInputT['default_source']>('marketplace');
  const [paths, setPaths] = useState<Record<FieldKey, string>>(EMPTY_PATHS);
  const [withConsent, setWithConsent] = useState(false);
  const [checkboxPath, setCheckboxPath] = useState('');
  const [wordingPath, setWordingPath] = useState('');
  const [consentType, setConsentType] = useState<'express' | 'implied_inquiry' | 'implied_ebr'>('express');
  const [channels, setChannels] = useState<string[]>(['sms']);
  const [scopes, setScopes] = useState<string[]>(['conversational']);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!orgId) return;
    setFormError(null);
    const field_map: Partial<Record<FieldKey, string[]>> = {};
    for (const f of ConnectorField.options) {
      const parts = paths[f].split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0) field_map[f] = parts;
    }
    try {
      await createConnector.mutateAsync({
        organization_id: orgId,
        source_key: sourceKey.trim(),
        label: label.trim(),
        type,
        default_source: defaultSource,
        field_map,
        dedupe_fields: ['phone', 'email'],
        ...(withConsent
          ? {
              consent: {
                ...(checkboxPath.trim() ? { checkbox_path: checkboxPath.trim() } : {}),
                ...(wordingPath.trim() ? { wording_path: wordingPath.trim() } : {}),
                grants: {
                  consent_type: consentType,
                  // The checkboxes only offer enum members; the assertion just
                  // restores what the string[] state erased.
                  channels: channels as ('sms' | 'mms' | 'email' | 'voice')[],
                  scopes: scopes as ('conversational' | 'marketing' | 'ai_outbound_call')[],
                },
              },
            }
          : {}),
      });
      setSourceKey('');
      setLabel('');
      setPaths(EMPTY_PATHS);
      setWithConsent(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  async function onToggleActive(row: TenantConnectorT) {
    setRowError(null);
    try {
      await updateConnector.mutateAsync({ id: row.id, is_active: !row.is_active });
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  async function onDelete(row: TenantConnectorT) {
    setRowError(null);
    try {
      await deleteConnector.mutateAsync(row.id);
    } catch (err) {
      setRowError(
        err instanceof ApiError && err.code === 'connector_in_use'
          ? t('inUse')
          : err instanceof ApiError
            ? err.message
            : t('genericError'),
      );
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        <p className="mt-1 text-sm">
          <Link to="/leads" className="font-medium text-primary-text underline-offset-4 hover:underline">
            {t('backToLeads')}
          </Link>
        </p>
        {multiOrg ? (
          <div className="mt-3 max-w-xs space-y-1">
            <Label htmlFor="cx-org">{t('orgScope')}</Label>
            <Select id="cx-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </header>

      <form onSubmit={(e) => void onCreate(e)} className="max-w-4xl space-y-4 rounded-lg border border-border p-4" aria-label={t('createTitle')}>
        <h2 className="text-lg font-medium">{t('createTitle')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="cx-key">{t('sourceKey')}</Label>
            <Input id="cx-key" value={sourceKey} onChange={(e) => setSourceKey(e.target.value)} required pattern="[a-z0-9_]{2,40}" />
            <p className="text-xs text-muted-foreground">{t('sourceKeyHint')}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cx-label">{t('label')}</Label>
            <Input id="cx-label" value={label} onChange={(e) => setLabel(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cx-type">{t('type')}</Label>
            <Select id="cx-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="json_webhook">{t('type_json_webhook')}</option>
              <option value="adf_xml">{t('type_adf_xml')}</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cx-source">{t('defaultSource')}</Label>
            <Select id="cx-source" value={defaultSource} onChange={(e) => setDefaultSource(e.target.value as typeof defaultSource)}>
              {LeadSource.options.map((sourceOption) => (
                <option key={sourceOption} value={sourceOption}>{tLeads(LEAD_SOURCE_KEYS[sourceOption])}</option>
              ))}
            </Select>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('mappingTitle')}</legend>
          <p className="text-xs text-muted-foreground">{t('mappingHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ConnectorField.options.map((f) => (
              <div key={f} className="space-y-1">
                <Label htmlFor={`cx-map-${f}`}>{t(`field_${f}`)}</Label>
                <Input
                  id={`cx-map-${f}`}
                  value={paths[f]}
                  onChange={(e) => setPaths((p) => ({ ...p, [f]: e.target.value }))}
                  placeholder={t('mappingPlaceholder')}
                />
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            <label className="flex items-center gap-2 max-lg:min-h-11">
              <input type="checkbox" checked={withConsent} onChange={(e) => setWithConsent(e.target.checked)} className="size-4 accent-primary-text" />
              {t('consentTitle')}
            </label>
          </legend>
          {withConsent ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="cx-cb" optionalText={tCommon('optional')}>{t('checkboxPath')}</Label>
                <Input id="cx-cb" value={checkboxPath} onChange={(e) => setCheckboxPath(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cx-word" optionalText={tCommon('optional')}>{t('wordingPath')}</Label>
                <Input id="cx-word" value={wordingPath} onChange={(e) => setWordingPath(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cx-ct">{t('consentType')}</Label>
                <Select id="cx-ct" value={consentType} onChange={(e) => setConsentType(e.target.value as typeof consentType)}>
                  {ConsentType.options.map((ct) => (
                    <option key={ct} value={ct}>{t(`consent_${ct}`)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <span className="text-sm font-medium">{t('channels')}</span>
                <div className="flex flex-wrap gap-3">
                  {ConsentChannel.options.map((ch) => (
                    <label key={ch} className="flex items-center gap-1 text-sm max-lg:min-h-11">
                      <input type="checkbox" checked={channels.includes(ch)} onChange={() => toggle(channels, setChannels, ch)} className="size-4 accent-primary-text" />
                      {ch.toUpperCase()}
                    </label>
                  ))}
                </div>
                <span className="text-sm font-medium">{t('scopes')}</span>
                <div className="flex flex-wrap gap-3">
                  {ConsentScope.options.map((sc) => (
                    <label key={sc} className="flex items-center gap-1 text-sm max-lg:min-h-11">
                      <input type="checkbox" checked={scopes.includes(sc)} onChange={() => toggle(scopes, setScopes, sc)} className="size-4 accent-primary-text" />
                      {t(`scope_${sc}`)}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('consentOffHint')}</p>
          )}
        </fieldset>

        <Button type="submit" disabled={createConnector.isPending || sourceKey.trim() === '' || label.trim() === '' || orgId === undefined}>
          {t('createButton')}
        </Button>
        {formError ? <p role="alert" className="text-sm text-danger-text">{formError}</p> : null}
      </form>

      {rowError ? <p role="alert" className="text-sm text-danger-text">{rowError}</p> : null}

      {connectors.isPending ? (
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : (connectors.data?.items.length ?? 0) === 0 ? (
        <div className="max-w-4xl rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{t('empty')}</div>
      ) : (
        <ul className="max-w-4xl space-y-2">
          {connectors.data?.items.map((row) => (
            <li key={row.id} className={`flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm ${row.is_active ? '' : 'opacity-60'}`}>
              <span className="font-medium">{row.label}</span>
              <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{row.source_key}</code>
              <span className="text-xs text-muted-foreground">{t(`type_${row.type}`)}</span>
              <span className="text-xs text-muted-foreground">{tLeads(LEAD_SOURCE_KEYS[row.default_source])}</span>
              {row.consent ? (
                <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs text-success-text">{t('hasConsent')}</span>
              ) : null}
              <span className="ms-auto flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => void onToggleActive(row)} disabled={updateConnector.isPending}>
                  {row.is_active ? t('deactivate') : t('activate')}
                </Button>
                <Button type="button" variant="outline" onClick={() => void onDelete(row)} disabled={deleteConnector.isPending}>
                  {t('delete', { label: row.label })}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
