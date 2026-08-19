import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import {
  ScoringRuleField,
  ScoringRuleOperator,
  type LeadScoringRuleT,
} from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations, useStores } from '../organizations/api.js';
import {
  useCreateScoringRule, useDeleteScoringRule, useScoringRules, useUpdateScoringRule,
} from './api.js';

/**
 * F-39 — the scoring rules screen (leads.md §6).
 *
 * An owner's console: every rule visible with its points and reach, off is a
 * toggle (the rule stays, inert), delete is for rules that were wrong. The API
 * enforces `organization:update` on every write — this screen renders for any
 * member, and a salesperson who tries anyway gets the server's refusal, not a
 * hidden button pretending the endpoint is protected.
 *
 * Field and operator labels are localized; the VALUE stays raw text — it is
 * matched against data verbatim, and translating "walk_in" would translate it
 * into never matching.
 */

const NEEDS_NO_VALUE = new Set(['exists', 'not_exists']);

interface Draft {
  store_id: string;
  name: string;
  field: LeadScoringRuleT['field'];
  operator: LeadScoringRuleT['operator'];
  value: string;
  score: string;
  priority: string;
}

const INITIAL: Draft = {
  store_id: '', name: '', field: 'has_phone', operator: 'exists', value: '', score: '10', priority: '100',
};

export function ScoringRulesPage() {
  const { t } = useTranslation('scoring');
  const { t: tCommon } = useTranslation('common');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const stores = useStores(orgId ?? '');

  const rules = useScoringRules(orgId, { enabled: orgId !== undefined });
  const createRule = useCreateScoringRule();
  const updateRule = useUpdateScoringRule();
  const deleteRule = useDeleteScoringRule();

  const [draft, setDraft] = useState<Draft>(INITIAL);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setFormError(null);
  }

  const valueless = NEEDS_NO_VALUE.has(draft.operator);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!orgId) return;
    setFormError(null);
    const score = Number(draft.score);
    const priority = Number(draft.priority);
    if (!Number.isInteger(score) || score < -100 || score > 100) {
      setFormError(t('scoreInvalid'));
      return;
    }
    try {
      await createRule.mutateAsync({
        organization_id: orgId,
        ...(draft.store_id === '' ? {} : { store_id: draft.store_id }),
        name: draft.name.trim(),
        field: draft.field,
        operator: draft.operator,
        ...(valueless || draft.value.trim() === '' ? {} : { value: draft.value.trim() }),
        score,
        priority: Number.isInteger(priority) ? priority : 100,
      });
      setDraft(INITIAL);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  async function onToggle(rule: LeadScoringRuleT) {
    setRowError(null);
    try {
      await updateRule.mutateAsync({ id: rule.id, is_active: !rule.is_active });
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  async function onDelete(rule: LeadScoringRuleT) {
    setRowError(null);
    try {
      await deleteRule.mutateAsync(rule.id);
      setConfirmDelete(null);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  const storeName = (id: string | null) =>
    id === null ? t('scopeGlobal') : (stores.data?.items.find((s) => s.id === id)?.name ?? '…');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        <p className="mt-1 text-sm">
          <Link to="/leads" className="font-medium text-primary underline-offset-4 hover:underline">
            {t('backToLeads')}
          </Link>
        </p>
        {multiOrg ? (
          <div className="mt-3 max-w-xs space-y-1">
            <Label htmlFor="sc-org">{t('orgScope')}</Label>
            <Select id="sc-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </header>

      <form onSubmit={(e) => void onCreate(e)} className="grid max-w-5xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('createTitle')}>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="sc-name">{t('ruleName')}</Label>
          <Input id="sc-name" value={draft.name} onChange={(e) => set('name', e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sc-field">{t('field')}</Label>
          <Select id="sc-field" value={draft.field} onChange={(e) => set('field', e.target.value as Draft['field'])}>
            {ScoringRuleField.options.map((f) => (
              <option key={f} value={f}>{t(`field_${f}`)}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sc-op">{t('operator')}</Label>
          <Select id="sc-op" value={draft.operator} onChange={(e) => set('operator', e.target.value as Draft['operator'])}>
            {ScoringRuleOperator.options.map((o) => (
              <option key={o} value={o}>{t(`op_${o}`)}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sc-value" optionalText={valueless ? tCommon('optional') : undefined}>
            {t('value')}
          </Label>
          <Input
            id="sc-value"
            value={valueless ? '' : draft.value}
            onChange={(e) => set('value', e.target.value)}
            disabled={valueless}
            required={!valueless}
          />
          <p className="text-xs text-muted-foreground">{valueless ? t('valueNotNeeded') : t('valueHint')}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sc-score">{t('points')}</Label>
          <Input id="sc-score" type="number" inputMode="numeric" min={-100} max={100} value={draft.score} onChange={(e) => set('score', e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sc-priority">{t('priority')}</Label>
          <Input id="sc-priority" type="number" inputMode="numeric" min={0} max={1000} value={draft.priority} onChange={(e) => set('priority', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sc-store" optionalText={tCommon('optional')}>{t('store')}</Label>
          <Select id="sc-store" value={draft.store_id} onChange={(e) => set('store_id', e.target.value)}>
            <option value="">{t('scopeGlobal')}</option>
            {stores.data?.items.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={createRule.isPending || draft.name.trim() === '' || orgId === undefined}>
            {t('createButton')}
          </Button>
        </div>
        {formError ? (
          <p role="alert" className="text-sm text-danger-text sm:col-span-2 lg:col-span-4">{formError}</p>
        ) : null}
      </form>

      {rowError ? <p role="alert" className="text-sm text-danger-text">{rowError}</p> : null}

      {rules.isPending ? (
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : rules.isError ? (
        <p role="alert" className="text-sm text-danger-text">{t('genericError')}</p>
      ) : (rules.data?.items.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{t('empty')}</div>
      ) : (
        <ul className="max-w-5xl space-y-2">
          {rules.data?.items.map((rule) => (
            <li key={rule.id} className={`flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm ${rule.is_active ? '' : 'opacity-60'}`}>
              <span className="font-medium">{rule.name}</span>
              <span className="text-muted-foreground">
                {t(`field_${rule.field}`)} · {t(`op_${rule.operator}`)}{rule.value === null ? '' : ` · ${rule.value}`}
              </span>
              <span className={`font-mono tabular-nums ${rule.score >= 0 ? 'text-success-text' : 'text-danger-text'}`}>
                {rule.score > 0 ? `+${rule.score}` : rule.score}
              </span>
              <span className="text-xs text-muted-foreground">{storeName(rule.store_id)}</span>
              {rule.is_active ? null : (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{t('inactive')}</span>
              )}
              <span className="ms-auto flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => void onToggle(rule)} disabled={updateRule.isPending}>
                  {rule.is_active ? t('deactivate') : t('activate')}
                </Button>
                {confirmDelete === rule.id ? (
                  <>
                    <Button type="button" variant="destructive" onClick={() => void onDelete(rule)} disabled={deleteRule.isPending}>
                      {t('deleteConfirm', { name: rule.name })}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setConfirmDelete(null)}>
                      {t('deleteKeep')}
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setConfirmDelete(rule.id)}>
                    {t('delete', { name: rule.name })}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
