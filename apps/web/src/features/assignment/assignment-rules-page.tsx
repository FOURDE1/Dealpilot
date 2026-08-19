import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import { AssignmentStrategy, type LeadAssignmentRuleT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations } from '../organizations/api.js';
import { useMembers } from '../team/api.js';
import {
  useAssignmentRules, useCreateAssignmentRule, useDeleteAssignmentRule, useUpdateAssignmentRule,
} from './api.js';

/**
 * F-40 — the assignment rules screen (leads.md §7).
 *
 * One rule wins here (priority ASCENDING, first source match) — the screen
 * says so, because the scoring page next door works the opposite way and an
 * owner who configures both deserves to be told which is which.
 *
 * `source_mappings` (source → specific person) has no editor yet: it needs a
 * per-source picker that this first cut does not carry. The API accepts it,
 * the engine honours it, and the row DISPLAYS it when present — configured by
 * API until the editor lands, and visibly so, not silently dropped.
 */

const STRATEGY_KEYS = {
  round_robin: 'strategy_round_robin',
  load_balanced: 'strategy_load_balanced',
  source_based: 'strategy_source_based',
} as const satisfies Record<LeadAssignmentRuleT['strategy'], string>;

interface Draft {
  name: string;
  strategy: LeadAssignmentRuleT['strategy'];
  priority: string;
  sources: string;
  max_leads_per_user: string;
  included_users: string[];
  excluded_users: string[];
}

const INITIAL: Draft = {
  name: '', strategy: 'round_robin', priority: '1', sources: '', max_leads_per_user: '0',
  included_users: [], excluded_users: [],
};

export function AssignmentRulesPage() {
  const { t } = useTranslation('assignment');
  const { t: tCommon } = useTranslation('common');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const members = useMembers(orgId, { enabled: orgId !== undefined });

  const rules = useAssignmentRules(orgId, { enabled: orgId !== undefined });
  const createRule = useCreateAssignmentRule();
  const updateRule = useUpdateAssignmentRule();
  const deleteRule = useDeleteAssignmentRule();

  const [draft, setDraft] = useState<Draft>(INITIAL);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setFormError(null);
  }

  function picked(select: HTMLSelectElement): string[] {
    return [...select.selectedOptions].map((o) => o.value);
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!orgId) return;
    setFormError(null);
    const cap = Number(draft.max_leads_per_user);
    const priority = Number(draft.priority);
    try {
      await createRule.mutateAsync({
        organization_id: orgId,
        name: draft.name.trim(),
        strategy: draft.strategy,
        priority: Number.isInteger(priority) ? priority : 1,
        sources: draft.sources.split(',').map((s) => s.trim()).filter((s) => s !== ''),
        included_users: draft.included_users,
        excluded_users: draft.excluded_users,
        source_mappings: {},
        max_leads_per_user: Number.isInteger(cap) && cap >= 0 ? cap : 0,
      });
      setDraft(INITIAL);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  async function onToggle(rule: LeadAssignmentRuleT) {
    setRowError(null);
    try {
      await updateRule.mutateAsync({ id: rule.id, is_active: !rule.is_active });
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  async function onDelete(rule: LeadAssignmentRuleT) {
    setRowError(null);
    try {
      await deleteRule.mutateAsync(rule.id);
      setConfirmDelete(null);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  const memberName = (id: string) => members.data?.items.find((m) => m.user_id === id)?.name ?? '…';

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
            <Label htmlFor="ar-org">{t('orgScope')}</Label>
            <Select id="ar-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </header>

      <form onSubmit={(e) => void onCreate(e)} className="grid max-w-5xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('createTitle')}>
        <div className="space-y-1">
          <Label htmlFor="ar-name">{t('ruleName')}</Label>
          <Input id="ar-name" value={draft.name} onChange={(e) => set('name', e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ar-strategy">{t('strategy')}</Label>
          <Select id="ar-strategy" value={draft.strategy} onChange={(e) => set('strategy', e.target.value as Draft['strategy'])}>
            {AssignmentStrategy.options.map((s) => (
              <option key={s} value={s}>{t(STRATEGY_KEYS[s])}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ar-priority">{t('priority')}</Label>
          <Input id="ar-priority" type="number" inputMode="numeric" min={0} max={1000} value={draft.priority} onChange={(e) => set('priority', e.target.value)} />
          <p className="text-xs text-muted-foreground">{t('priorityHint')}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ar-sources" optionalText={tCommon('optional')}>{t('sources')}</Label>
          <Input id="ar-sources" value={draft.sources} onChange={(e) => set('sources', e.target.value)} />
          <p className="text-xs text-muted-foreground">{t('sourcesHint')}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ar-cap">{t('cap')}</Label>
          <Input id="ar-cap" type="number" inputMode="numeric" min={0} max={1000} value={draft.max_leads_per_user} onChange={(e) => set('max_leads_per_user', e.target.value)} />
          <p className="text-xs text-muted-foreground">{t('capHint')}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ar-included" optionalText={tCommon('optional')}>{t('included')}</Label>
          <Select id="ar-included" multiple size={3} value={draft.included_users} onChange={(e) => set('included_users', picked(e.target))}>
            {members.data?.items.filter((m) => m.status === 'active').map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.name}</option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{t('includedHint')}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ar-excluded" optionalText={tCommon('optional')}>{t('excluded')}</Label>
          <Select id="ar-excluded" multiple size={3} value={draft.excluded_users} onChange={(e) => set('excluded_users', picked(e.target))}>
            {members.data?.items.filter((m) => m.status === 'active').map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.name}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={createRule.isPending || draft.name.trim() === '' || orgId === undefined}>
            {t('createButton')}
          </Button>
        </div>
        {formError ? (
          <p role="alert" className="text-sm text-danger-text sm:col-span-2 lg:col-span-3">{formError}</p>
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
              <span className="font-mono text-xs text-muted-foreground">#{rule.priority}</span>
              <span className="font-medium">{rule.name}</span>
              <span className="text-muted-foreground">{t(STRATEGY_KEYS[rule.strategy])}</span>
              <span className="text-xs text-muted-foreground">
                {rule.sources.length === 0 ? t('allSources') : rule.sources.join(', ')}
              </span>
              {rule.max_leads_per_user > 0 ? (
                <span className="text-xs text-muted-foreground">{t('capBadge', { cap: rule.max_leads_per_user })}</span>
              ) : null}
              {rule.excluded_users.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {t('excludedBadge', { names: rule.excluded_users.map(memberName).join(', ') })}
                </span>
              ) : null}
              {Object.keys(rule.source_mappings).length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {Object.entries(rule.source_mappings).map(([s, u]) => `${s} → ${memberName(u)}`).join(' · ')}
                </span>
              ) : null}
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
