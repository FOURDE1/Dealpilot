import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import {
  buttonVariants,
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
import { ROLES, type MemberT, type RoleT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations } from '../organizations/api.js';
import { useSession } from '../../shared/auth/client.js';
import { useMembers, useUpdateMember } from './api.js';
import { PayPlanDialog } from '../commissions/pay-plan-dialog.js';
import { useCreateInvitation, useInvitations, useRevokeInvitation } from '../invitations/api.js';
import type { InvitationT } from '@dealpilot/schemas';

export const ROLE_KEYS = {
  owner: 'role_owner',
  gm: 'role_gm',
  sales_manager: 'role_sales_manager',
  used_car_manager: 'role_used_car_manager',
  fi_manager: 'role_fi_manager',
  salesperson: 'role_salesperson',
  wholesale_manager: 'role_wholesale_manager',
  logistics: 'role_logistics',
  admin_office: 'role_admin_office',
  bdc_agent: 'role_bdc_agent',
} as const satisfies Record<RoleT, string>;

/** Mirror of the API's MEMBER_WRITE_ROLES — the server still enforces. */
const WRITE_ROLES = new Set<RoleT>(['owner', 'gm', 'admin_office']);
/** Mirror of PAY_WRITE_ROLES — pay plans are owner/gm territory. */
const PAY_ROLES = new Set<RoleT>(['owner', 'gm']);

const STATUS_KEYS = {
  active: 'status_active',
  invited: 'status_invited',
  revoked: 'status_revoked',
} as const satisfies Record<MemberT['status'], string>;

function RoleCheckboxes({
  value,
  onChange,
  idPrefix,
}: {
  value: readonly RoleT[];
  onChange: (roles: RoleT[]) => void;
  idPrefix: string;
}) {
  const { t } = useTranslation('team');
  usePageTitle(t('title'));
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{t('rolesCol')}</legend>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {ROLES.map((role) => {
          const id = `${idPrefix}-${role}`;
          const checked = value.includes(role);
          return (
            <label key={role} htmlFor={id} className="flex items-center gap-2 text-sm max-lg:min-h-11">
              <input
                id={id}
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(checked ? value.filter((r) => r !== role) : [...value, role])
                }
                className="size-4 accent-[var(--primary)]"
              />
              {t(ROLE_KEYS[role])}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function TeamPage() {
  const { t } = useTranslation('team');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const { data: session } = useSession();
  const noOrg = orgs.isSuccess && orgs.data.items.length === 0;
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const members = useMembers(orgId, { enabled: !noOrg });
  const updateMember = useUpdateMember(orgId);
  const invitations = useInvitations(multiOrg ? orgId : undefined, { enabled: !noOrg });
  const createInvitation = useCreateInvitation(orgId);
  const revokeInvitation = useRevokeInvitation(orgId);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const me = members.data?.items.find((m) => m.user_id === session?.user.id);
  const canWrite = me?.roles.some((r) => WRITE_ROLES.has(r)) ?? false;
  const canPay = me?.roles.some((r) => PAY_ROLES.has(r)) ?? false;
  const [showRemoved, setShowRemoved] = useState(false);
  const [removedError, setRemovedError] = useState<string | null>(null);
  const removed = useMembers(orgId, { enabled: !noOrg && showRemoved, status: 'revoked' });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<RoleT[]>(['salesperson']);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<MemberT | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<MemberT | null>(null);
  const [planTarget, setPlanTarget] = useState<MemberT | null>(null);
  const [editRoles, setEditRoles] = useState<RoleT[]>([]);
  const [editError, setEditError] = useState<string | null>(null);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (roles.length === 0) {
      setError(t('rolesRequired'));
      return;
    }
    if (!orgId) return;
    setInviteLink(null);
    try {
      const inv = await createInvitation.mutateAsync({
        organization_id: orgId,
        email,
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        roles,
      });
      if (inv.accept_url) {
        // Email delivery failed — hand the owner the link instead of a dead end.
        setNotice(t('emailNotSent'));
        setInviteLink(inv.accept_url);
      } else {
        setNotice(t('inviteSent', { email: inv.email }));
      }
      setName('');
      setEmail('');
      setRoles(['salesperson']);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(
        err.status === 409
          ? err.code === 'already_member'
            ? t('alreadyMember')
            : t('emailInUse')
          : err.status === 422 && err.fieldPath === 'email'
            ? t('invalidEmail')
            : err.status === 403
              ? t('roleNotGrantable')
              : t('genericError'),
      );
    }
  }

  type RosterRow = MemberT & { __invitationId?: string };
  const rosterRows = useMemo<RosterRow[]>(() => {
    const invited: RosterRow[] = (invitations.data?.items ?? []).map((inv: InvitationT) => ({
      id: inv.id,
      user_id: inv.id,
      organization_id: inv.organization_id,
      store_id: inv.store_id,
      roles: inv.roles,
      status: 'invited' as const,
      email: inv.email,
      name: inv.name ?? inv.email,
      created_at: inv.created_at,
      updated_at: inv.updated_at,
      __invitationId: inv.id,
    }));
    return [...(members.data?.items ?? []), ...invited];
  }, [members.data, invitations.data]);

  const columns = useMemo<ColumnDef<RosterRow, unknown>[]>(
    () => [
      { accessorKey: 'name', header: t('name') },
      {
        accessorKey: 'email',
        header: t('email'),
        cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.email}</span>,
      },
      {
        accessorKey: 'roles',
        header: t('rolesCol'),
        cell: ({ row }) => row.original.roles.map((r) => t(ROLE_KEYS[r])).join(', '),
      },
      {
        accessorKey: 'status',
        header: t('statusCol'),
        cell: ({ row }) => t(STATUS_KEYS[row.original.status]),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('actionsCol')}</span>,
        cell: ({ row }) =>
          !canWrite || row.original.status === 'revoked' ? null : row.original.__invitationId ? (
            <span className="flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={revokeInvitation.isPending}
                aria-label={t('revokeInviteFor', { name: row.original.email })}
                onClick={() => void revokeInvitation.mutateAsync(row.original.__invitationId ?? '')}
              >
                {t('revokeInvite')}
              </Button>
            </span>
          ) : (
            <span className="flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('editRolesFor', { name: row.original.name })}
                onClick={() => {
                  setEditTarget(row.original);
                  setEditRoles([...row.original.roles]);
                  setEditError(null);
                }}
              >
                {t('editRoles')}
              </Button>
              {canPay ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('payPlanFor', { name: row.original.name })}
                  onClick={() => setPlanTarget(row.original)}
                >
                  {t('payPlan')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('revokeFor', { name: row.original.name })}
                onClick={() => setRevokeTarget(row.original)}
              >
                {t('revoke')}
              </Button>
            </span>
          ),
      },
    ],
    [t, canWrite, canPay],
  );

  if (noOrg)
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('noOrg')}</p>
        <Link to="/organizations/new" className={buttonVariants()}>
          {t('noOrgCta')}
        </Link>
      </div>
    );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        {multiOrg ? (
          <div className="mt-3 max-w-xs space-y-1">
            <Label htmlFor="team-org-scope">{t('orgScope')}</Label>
            <Select
              id="team-org-scope"
              value={orgId ?? ''}
              onChange={(e) => {
                setOrgFilter(e.target.value);
                setRemovedError(null);
              }}
            >
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </header>

      {canWrite ? (
      <form
        noValidate
        onSubmit={(e) => void handleAdd(e)}
        className="space-y-3 rounded-lg border border-border bg-card p-4"
        aria-labelledby="team-add-title"
      >
        <h2 id="team-add-title" className="text-[15px] font-semibold">
          {t('addTitle')}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="member-name">{t('name')}</Label>
            <Input id="member-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="member-email">{t('email')}</Label>
            <Input
              id="member-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>
        <RoleCheckboxes value={roles} onChange={setRoles} idPrefix="add-role" />
        {error ? (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className={`text-sm ${inviteLink ? 'text-warning-text' : 'text-success-text'}`}>
            {notice}
          </p>
        ) : null}
        {inviteLink ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor="invite-link">{t('inviteLink')}</Label>
              <Input id="invite-link" readOnly value={inviteLink} className="font-mono text-[12px]" onFocus={(e) => e.target.select()} />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard.writeText(inviteLink)}
            >
              {t('copyLink')}
            </Button>
          </div>
        ) : null}
        <Button type="submit" disabled={createInvitation.isPending || email.trim() === ''}>
          {createInvitation.isPending ? t('inviting') : t('invite')}
        </Button>
      </form>
      ) : null}

      <DataTable
        columns={columns}
        data={rosterRows}
        isPending={orgs.isPending || members.isPending || invitations.isPending}
        isError={members.isError || invitations.isError}
        loadingMessage={t('loading')}
        errorMessage={t('loadError')}
        emptyMessage={t('empty')}
      />

      <label htmlFor="team-show-removed" className="flex w-fit items-center gap-2 text-sm max-lg:min-h-11">
        <input
          id="team-show-removed"
          type="checkbox"
          checked={showRemoved}
          onChange={(e) => {
            setShowRemoved(e.target.checked);
            setRemovedError(null);
          }}
          className="size-4 accent-[var(--primary)]"
        />
        {t('showRemoved')}
      </label>
      {showRemoved ? (
        removed.isPending ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : removed.isError ? (
          <p role="alert" className="text-sm text-danger-text">
            {t('loadError')}
          </p>
        ) : removed.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noRemoved')}</p>
        ) : (
          <>
          {removedError ? (
            <p role="alert" className="text-sm text-danger-text">
              {removedError}
            </p>
          ) : null}
          <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4">
            {removed.data.items.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span>
                  {m.name} <span className="font-mono text-[13px] text-muted-foreground">{m.email}</span>
                  <span className="block text-[13px] text-muted-foreground">
                    {m.roles.map((r) => t(ROLE_KEYS[r])).join(', ')}
                  </span>
                </span>
                {canWrite ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={updateMember.isPending}
                    aria-label={t('reinstateFor', { name: m.name })}
                    onClick={() => {
                      setRemovedError(null);
                      updateMember.mutateAsync({ id: m.id, body: { status: 'active' } }).catch((err: unknown) => {
                        setRemovedError(
                          err instanceof ApiError && err.status === 403
                            ? t('roleNotGrantable')
                            : t('genericError'),
                        );
                        if (!(err instanceof ApiError)) throw err;
                      });
                    }}
                  >
                    {t('reinstate')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          </>
        )
      ) : null}

      <PayPlanDialog
        member={planTarget}
        orgId={orgId}
        colleagues={members.data?.items ?? []}
        onClose={() => setPlanTarget(null)}
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
            {revokeTarget ? t('revokeBody', { name: revokeTarget.name }) : ''}
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
              disabled={updateMember.isPending}
              onClick={() => {
                if (!revokeTarget) return;
                setRevokeError(null);
                updateMember
                  .mutateAsync({ id: revokeTarget.id, body: { status: 'revoked' } })
                  .then(() => setRevokeTarget(null))
                  .catch((err: unknown) => {
                    if (!(err instanceof ApiError)) throw err;
                    setRevokeError(err.status === 422 ? t('lastOwner') : t('genericError'));
                  });
              }}
            >
              {t('confirmRevoke')}
            </Button>
          </div>
        </DialogContent>
      </Dialog.Root>

      <Dialog.Root
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
          setEditError(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {editTarget ? t('editRolesFor', { name: editTarget.name }) : t('editRoles')}
          </DialogTitle>
          <div className="mt-4">
            <RoleCheckboxes value={editRoles} onChange={setEditRoles} idPrefix="edit-role" />
          </div>
          {editError ? (
            <p role="alert" className="mt-2 text-sm text-danger-text">
              {editError}
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
              disabled={updateMember.isPending || editRoles.length === 0}
              onClick={() => {
                if (!editTarget) return;
                setEditError(null);
                updateMember
                  .mutateAsync({ id: editTarget.id, body: { roles: editRoles } })
                  .then(() => setEditTarget(null))
                  .catch((err: unknown) => {
                    if (!(err instanceof ApiError)) throw err;
                    setEditError(
                      err.status === 403
                        ? t('roleNotGrantable')
                        : err.status === 422
                          ? t('lastOwner')
                          : t('genericError'),
                    );
                  });
              }}
            >
              {updateMember.isPending ? t('saving') : t('save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog.Root>
    </div>
  );
}
