import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
  Select,
  type ColumnDef,
} from '@dealpilot/ui';
import {
  IntakeKey,
  IntakeKeyCreated,
  IntakeProvider,
  LEAD_SOURCES,
  paginated,
  type IntakeKeyCreatedT,
  type IntakeKeyT,
} from '@dealpilot/schemas';
import { ApiError, apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { LEAD_SOURCE_KEYS } from '../leads/labels.js';
import { BUILT_IN_CONNECTORS } from '@dealpilot/core';
import { useConnectors } from '../connectors/api.js';

const PaginatedKeys = paginated(IntakeKey);
const PROVIDERS = IntakeProvider.options;

const PROVIDER_KEYS = {
  generic_json: 'provider_generic_json',
  fluent_form: 'provider_fluent_form',
  meta: 'provider_meta',
  adf_email: 'provider_adf_email',
  chat_widget: 'provider_chat_widget',
} as const satisfies Record<IntakeKeyT['provider'], string>;

// FR-first labels for the built-in presets; core's English label is only the
// fallback for a preset added before its translation.
const BUILTIN_LABEL_KEYS: Record<string, string> = {
  website_form: 'builtin_website_form',
  meta_lead_ads: 'builtin_meta_lead_ads',
  adf_xml: 'builtin_adf_xml',
};

const intakeKeysKey = (orgId: string) => ['intake-keys', orgId] as const;

function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation('intake');
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <span className="block text-[13px] font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-input-bg px-2 py-1.5 font-mono text-[12px]">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${t('copy')} — ${label}`}
          onClick={() => {
            navigator.clipboard.writeText(value).then(() => setCopied(true)).catch(() => setCopied(false));
          }}
        >
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
    </div>
  );
}

/** Per-store webhook credentials (F-03): create → one-time secret → list/revoke. */
export function IntakeSources({ orgId, storeId }: { orgId: string; storeId: string }) {
  const { t, i18n } = useTranslation('intake');
  const { t: tLeads } = useTranslation('leads');
  const queryClient = useQueryClient();

  const keys = useQuery({
    queryKey: intakeKeysKey(orgId),
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.intakeKeys.list, {
        query: { organization_id: orgId, limit: 100 },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedKeys.parse(res.body);
    },
  });

  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState<IntakeKeyT['provider']>('generic_json');
  const [source, setSource] = useState<IntakeKeyT['default_source']>('website');
  const [connectorKey, setConnectorKey] = useState('website_form');
  const [created, setCreated] = useState<IntakeKeyCreatedT | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<IntakeKeyT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const createAlertRef = useRef<HTMLParagraphElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);

  const connectors = useConnectors(orgId);
  const activeConnectors = (connectors.data?.items ?? []).filter((c) => c.is_active);
  const connectorLabel = (key: string): string => {
    const builtin = BUILT_IN_CONNECTORS.find((c) => c.key === key);
    if (builtin) {
      const k = BUILTIN_LABEL_KEYS[key];
      return k ? t(k, { defaultValue: builtin.label }) : builtin.label;
    }
    return (connectors.data?.items ?? []).find((c) => c.source_key === key)?.label ?? key;
  };

  const createKey = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(routes.intakeKeys.create, {
        body: { organization_id: orgId, store_id: storeId, label, provider, default_source: source, connector_key: connectorKey },
      });
      if (res.status !== 201) fail(res.status, res.body);
      return IntakeKeyCreated.parse(res.body);
    },
    onSuccess: (key) => {
      setCreated(key);
      setLabel('');
      void queryClient.invalidateQueries({ queryKey: intakeKeysKey(orgId) });
    },
  });

  const revokeKey = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.intakeKeys.revoke, { params: { id } });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => {
      setRevokeTarget(null);
      void queryClient.invalidateQueries({ queryKey: intakeKeysKey(orgId) });
    },
  });

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createKey.mutateAsync();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(t('genericError'));
    }
  }

  useEffect(() => {
    if (error) createAlertRef.current?.focus();
  }, [error]);

  // Move focus INTO the one-time reveal so it is announced and unmissable.
  useEffect(() => {
    if (created) revealRef.current?.focus();
  }, [created]);

  const storeKeys = useMemo(
    () => keys.data?.items.filter((k) => k.store_id === storeId && k.active) ?? [],
    [keys.data, storeId],
  );

  const columns = useMemo<ColumnDef<IntakeKeyT, unknown>[]>(
    () => [
      { accessorKey: 'label', header: t('label') },
      {
        accessorKey: 'provider',
        header: t('provider'),
        cell: ({ row }) => t(PROVIDER_KEYS[row.original.provider]),
      },
      {
        accessorKey: 'connector_key',
        header: t('connector'),
        cell: ({ row }) => connectorLabel(row.original.connector_key),
      },
      {
        accessorKey: 'default_source',
        header: t('defaultSource'),
        cell: ({ row }) => tLeads(LEAD_SOURCE_KEYS[row.original.default_source]),
      },
      {
        accessorKey: 'last_used_at',
        header: t('lastUsed'),
        cell: ({ row }) =>
          row.original.last_used_at
            ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(row.original.last_used_at),
              )
            : t('never'),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('actions')}</span>,
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${t('revoke')} — ${row.original.label}`}
            onClick={() => setRevokeTarget(row.original)}
          >
            {t('revoke')}
          </Button>
        ),
      },
    ],
    [t, tLeads, i18n.language],
  );

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {created ? (
        <div
          ref={revealRef}
          tabIndex={-1}
          className="space-y-3 rounded-lg border border-warning bg-card p-4"
          role="region"
          aria-labelledby="intake-created-title"
        >
          <h3 id="intake-created-title" className="text-[15px] font-semibold">{t('createdTitle')}</h3>
          <p className="text-sm text-warning-text">{t('createdWarning')}</p>
          <CopyField label={t('webhookUrl')} value={created.webhook_url} />
          <CopyField label={t('secret')} value={created.secret} />
          <Button type="button" variant="secondary" size="sm" onClick={() => { setCreated(null); createKey.reset(); }}>
            {t('done')}
          </Button>
        </div>
      ) : null}

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="grid grid-cols-1 items-end gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]"
      >
        <div className="space-y-1">
          <Label htmlFor="intake-label">{t('label')}</Label>
          <Input id="intake-label" value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="intake-provider">{t('provider')}</Label>
          <Select
            id="intake-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as IntakeKeyT['provider'])}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {t(PROVIDER_KEYS[p])}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="intake-source">{t('defaultSource')}</Label>
          <Select
            id="intake-source"
            value={source}
            onChange={(e) => setSource(e.target.value as IntakeKeyT['default_source'])}
          >
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {tLeads(LEAD_SOURCE_KEYS[s])}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="intake-connector">{t('connector')}</Label>
          <Select
            id="intake-connector"
            value={connectorKey}
            onChange={(e) => setConnectorKey(e.target.value)}
          >
            <optgroup label={t('builtinGroup')}>
              {BUILT_IN_CONNECTORS.map((c) => (
                <option key={c.key} value={c.key}>
                  {connectorLabel(c.key)}
                </option>
              ))}
            </optgroup>
            {activeConnectors.length > 0 ? (
              <optgroup label={t('tenantGroup')}>
                {activeConnectors.map((c) => (
                  <option key={c.source_key} value={c.source_key}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
        </div>
        <Button type="submit" disabled={createKey.isPending || label.trim() === ''}>
          {createKey.isPending ? t('creating') : t('create')}
        </Button>
        {error ? (
          <p ref={createAlertRef} tabIndex={-1} role="alert" className="text-sm text-danger-text sm:col-span-2 lg:col-span-5">
            {error}
          </p>
        ) : null}
      </form>

      <DataTable
        columns={columns}
        data={storeKeys}
        isPending={keys.isPending}
        isError={keys.isError}
        loadingMessage={t('loading')}
        errorMessage={t('loadError')}
        emptyMessage={t('empty')}
      />

      <Dialog.Root
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
          setRevokeError(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{t('revokeTitle')}</DialogTitle>
          <DialogDescription>
            {t('revokeBody')} {revokeTarget ? `(${revokeTarget.label})` : ''}
          </DialogDescription>
          {revokeError ? (
            <p role="alert" className="mt-2 text-sm text-danger-text">
              {revokeError}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close
              render={
                <Button type="button" variant="outline">
                  {t('cancel')}
                </Button>
              }
            />
            <Button
              type="button"
              variant="destructive"
              disabled={revokeKey.isPending}
              onClick={() => {
                if (!revokeTarget) return;
                setRevokeError(null);
                revokeKey.mutateAsync(revokeTarget.id).catch((err: unknown) => {
                  if (!(err instanceof ApiError)) throw err;
                  setRevokeError(t('genericError'));
                });
              }}
            >
              {t('confirmRevoke')}
            </Button>
          </div>
        </DialogContent>
      </Dialog.Root>
    </section>
  );
}
