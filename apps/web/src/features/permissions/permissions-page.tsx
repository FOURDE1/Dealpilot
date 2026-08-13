import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackLink } from '../../shared/ui/back-link.js';
import { usePageTitle } from '../../shared/use-page-title.js';
import { Button, Label, Select } from '@dealpilot/ui';
import { PERMISSIONS, type PermissionT, type RoleT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations } from '../organizations/api.js';
import { useMembers } from '../team/api.js';
import { ROLE_KEYS } from '../team/team-page.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { usePermissionMatrix, useSetRolePermissions, useSetUserPermission, useUserOverrides } from './api.js';

/** Grouped the way a dealer thinks, not the way the schema is spelled. */
/**
 * Exported for the coverage test: every permission MUST match a prefix here,
 * or it silently disappears from the only screen that can grant it.
 */
export const GROUPS: { key: string; prefixes: string[] }[] = [
  { key: 'group_team', prefixes: ['member:'] },
  { key: 'group_leads', prefixes: ['lead:', 'intake_key:'] },
  { key: 'group_inventory', prefixes: ['vehicle:'] },
  { key: 'group_deals', prefixes: ['deal:', 'checklist:'] },
  { key: 'group_documents', prefixes: ['document:'] },
  { key: 'group_money', prefixes: ['pay_plan:', 'commission:'] },
  { key: 'group_dispatch', prefixes: ['dispatch:', 'fleet:'] },
  { key: 'group_conversations', prefixes: ['conversation:'] },
  { key: 'group_settings', prefixes: ['organization:', 'store:', 'activity:'] },
];

/** The ones where a wrong tick has consequences — say so next to the box. */
const RISKY: Partial<Record<PermissionT, string>> = {
  'checklist:correct_delivered': 'hint_coming',
  'checklist:sign_safety': 'hint_sign_safety',
  'commission:read_all': 'hint_read_all',
  'member:update_roles': 'hint_update_roles',
  'intake_key:manage': 'hint_intake_key',
  'document:sign': 'hint_document_sign',
};

export function PermissionsPage() {
  const { t } = useTranslation('permissions');
  const { t: tTeam } = useTranslation('team');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const scope = multiOrg ? orgId : undefined;
  const matrix = usePermissionMatrix(scope, { enabled: !orgs.isPending });
  const mine = usePermissionsMine(scope, { enabled: !orgs.isPending });
  const canEdit = can(mine.data, 'member:update_roles');
  const members = useMembers(orgId, { enabled: !orgs.isPending });
  const overrides = useUserOverrides(scope, { enabled: !orgs.isPending });
  const setRole = useSetRolePermissions();
  const setUser = useSetUserPermission();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Override form
  const [overrideUser, setOverrideUser] = useState('');
  const [overridePermission, setOverridePermission] = useState<PermissionT>('lead:create');
  const [overrideMode, setOverrideMode] = useState<'true' | 'false' | 'null'>('true');
  const [overrideReason, setOverrideReason] = useState('');

  const grouped = useMemo(() => {
    const list = matrix.data?.permissions ?? [...PERMISSIONS];
    return GROUPS.map((g) => ({
      key: g.key,
      permissions: list.filter((p) => g.prefixes.some((pre) => p.startsWith(pre))),
    })).filter((g) => g.permissions.length > 0);
  }, [matrix.data]);

  async function toggle(role: RoleT, permission: PermissionT, has: boolean) {
    if (!orgId || !matrix.data) return;
    setError(null);
    setNotice(null);
    const current = matrix.data.matrix[role] ?? [];
    const next = has ? current.filter((p) => p !== permission) : [...current, permission];
    try {
      // CR-10(a): the version this edit was made against. The server refuses a
      // save built on a stale view rather than silently undoing whoever saved
      // in between — the 409 is handled below.
      await setRole.mutateAsync({
        organization_id: orgId,
        role,
        permissions: next,
        base_version: matrix.data.versions[role] ?? 'empty',
      });
      setNotice(t('saved'));
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setError(t('genericError'));
        throw err;
      }
      setError(
        err.errorCode === 'would_lock_out' || err.code === 'would_lock_out'
          ? t('wouldLockOut')
          : err.status === 409 &&
              (err.errorCode === 'matrix_changed' || err.code === 'matrix_changed')
            ? t('matrixChanged')
            : err.status === 403
              ? t('readOnly')
              : t('genericError'),
      );
    }
  }

  async function applyOverride() {
    if (!orgId || overrideUser === '') return;
    setError(null);
    setNotice(null);
    // The matrix path refuses locking the owner out; the override path must
    // not become the back door (server guard filed as CR-10).
    if (overridePermission === 'member:update_roles' && overrideMode === 'false') {
      setError(t('wouldLockOut'));
      return;
    }
    if (overrideReason.trim().length < 3 && overrideMode !== 'null') {
      setError(t('reasonRequired'));
      return;
    }
    try {
      await setUser.mutateAsync({
        organization_id: orgId,
        user_id: overrideUser,
        permission: overridePermission,
        allowed: overrideMode === 'null' ? null : overrideMode === 'true',
        ...(overrideReason.trim() === '' ? {} : { reason: overrideReason.trim() }),
      });
      setNotice(overrideMode === 'null' ? t('overrideCleared') : t('overrideSaved'));
      setOverrideReason('');
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setError(t('genericError'));
        throw err;
      }
      setError(err.status === 403 ? t('readOnly') : t('genericError'));
    }
  }

  const roles = matrix.data?.roles ?? [];

  return (
    <div className="space-y-4">
      <BackLink to="/team">{t('back')}</BackLink>
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{canEdit ? t('subtitle') : t('subtitleReadOnly')}</p>
      </header>
      {multiOrg ? (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="perm-org">{t('orgScope')}</Label>
          <Select id="perm-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
            {orgs.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div aria-live="polite" className="sticky top-0 z-20 bg-background">
        {error ? (
          <p role="alert" className="py-1 text-sm text-danger-text">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="py-1 text-sm text-success-text">
            {notice}
          </p>
        ) : null}
      </div>

      {matrix.isPending || orgs.isPending ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('loading')}
        </p>
      ) : matrix.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('loadError')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-background">
              <tr>
                <th className="sticky left-0 bg-background p-2 text-start font-medium">{t('permissionCol')}</th>
                {roles.map((r) => (
                  <th key={r} className="p-2 text-center align-bottom font-medium">
                    {tTeam(ROLE_KEYS[r])}
                  </th>
                ))}
              </tr>
            </thead>
            {grouped.map((group) => (
              <tbody key={group.key}>
                <tr>
                  <th
                    colSpan={roles.length + 1}
                    className="sticky left-0 bg-muted/60 p-2 text-start text-[13px] font-semibold"
                  >
                    {t(group.key as never)}
                  </th>
                </tr>
                {group.permissions.map((permission) => (
                  <tr key={permission} className="border-t border-border">
                    <th className="sticky left-0 max-w-72 bg-background p-2 text-start font-normal">
                      {t(`perm_${permission.replace(':', '_')}` as never)}
                      {RISKY[permission] ? (
                        <span className="block text-xs text-warning-text">{t(RISKY[permission] as never)}</span>
                      ) : null}
                    </th>
                    {roles.map((role) => {
                      const has = (matrix.data.matrix[role] ?? []).includes(permission);
                      return (
                        <td key={role} className="p-2 text-center">
                          <input
                            type="checkbox"
                            checked={has}
                            disabled={!canEdit || setRole.isPending}
                            aria-label={t('cellFor', {
                              permission: t(`perm_${permission.replace(':', '_')}` as never),
                              role: tTeam(ROLE_KEYS[role]),
                            })}
                            onChange={() => void toggle(role, permission, has)}
                            className="size-6 accent-[var(--primary)]"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {canEdit ? (
        <section className="max-w-xl space-y-3 rounded-lg border border-border bg-card p-4" aria-labelledby="override-title">
          <div>
            <h2 id="override-title" className="text-[15px] font-semibold">
              {t('overrideTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('overrideNote')}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ov-user">{t('overrideUser')}</Label>
              <Select id="ov-user" value={overrideUser} onChange={(e) => setOverrideUser(e.target.value)}>
                <option value="">—</option>
                {(members.data?.items ?? [])
                  .filter((m) => m.status === 'active')
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-permission">{t('permissionCol')}</Label>
              <Select
                id="ov-permission"
                value={overridePermission}
                onChange={(e) => setOverridePermission(e.target.value as PermissionT)}
              >
                {[...PERMISSIONS].map((p) => (
                  <option key={p} value={p}>
                    {t(`perm_${p.replace(':', '_')}` as never)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-mode">{t('overrideMode')}</Label>
              <Select
                id="ov-mode"
                value={overrideMode}
                onChange={(e) => setOverrideMode(e.target.value as typeof overrideMode)}
              >
                <option value="true">{t('overrideAllow')}</option>
                <option value="false">{t('overrideDeny')}</option>
                <option value="null">{t('overrideClear')}</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-reason">{t('overrideReason')}</Label>
              <input
                id="ov-reason"
                value={overrideReason}
                maxLength={300}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-input-bg px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11"
              />
              <p className="text-xs text-muted-foreground">{t('overrideReasonHint')}</p>
            </div>
          </div>
          <Button type="button" disabled={setUser.isPending || overrideUser === ''} onClick={() => void applyOverride()}>
            {setUser.isPending ? t('saving') : t('applyOverride')}
          </Button>

          {overrides.isError ? (
            <p role="alert" className="text-sm text-danger-text">
              {t('loadError')}
            </p>
          ) : (overrides.data?.length ?? 0) > 0 ? (
            <div className="space-y-1 border-t border-border pt-3">
              <h3 className="text-sm font-semibold">{t('existingOverrides')}</h3>
              <ul className="divide-y divide-border text-sm">
                {overrides.data?.map((o) => {
                  const who = members.data?.items.find((m) => m.user_id === o.user_id)?.name ?? '—';
                  return (
                    <li key={`${o.user_id}-${o.permission}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span>
                        {who} — {t(`perm_${o.permission.replace(':', '_')}` as never)}{' '}
                        <span className={o.allowed ? 'text-success-text' : 'text-danger-text'}>
                          {o.allowed ? t('overrideAllow') : t('overrideDeny')}
                        </span>
                        {o.reason ? (
                          <span className="block text-xs text-muted-foreground">{o.reason}</span>
                        ) : null}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={setUser.isPending}
                        aria-label={t('clearFor', { name: who })}
                        onClick={() => {
                          setError(null);
                          setNotice(null);
                          setUser
                            .mutateAsync({
                              organization_id: orgId ?? '',
                              user_id: o.user_id,
                              permission: o.permission,
                              allowed: null,
                            })
                            .then(() => setNotice(t('overrideCleared')))
                            .catch((err: unknown) => {
                              setError(t('genericError'));
                              if (!(err instanceof ApiError)) throw err;
                            });
                        }}
                      >
                        {t('clearOverride')}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
