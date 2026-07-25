import { z } from 'zod';
import { CursorQuery, Email, IsoDateTime, Locale, PhoneE164, Uuid } from './common.js';
import { Role } from './roles.js';

export const UserStatus = z.enum(['invited', 'active', 'disabled']);
export const MembershipStatus = z.enum(['invited', 'active', 'revoked']);

const userName = z.string().trim().min(1).max(120);

export const User = z.object({
  id: Uuid,
  email: Email,
  name: userName,
  phone: PhoneE164.nullable(),
  /** Priority-1 locale-resolution source (media-i18n-validation.md §2.1). */
  language_pref: Locale,
  status: UserStatus,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/**
 * Membership = (user, organization, store, roles[]) — additive multi-role
 * (authentication-authorization.md §7). `store_id: null` means the roles apply
 * to every store in the organization (typical for `owner`). Tenant scope is
 * ALWAYS derived server-side from memberships, never from client input.
 */
export const Membership = z.object({
  id: Uuid,
  user_id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  roles: z.array(Role).min(1),
  status: MembershipStatus,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const CreateUserInput = z.strictObject({
  email: Email,
  name: userName,
  phone: PhoneE164.optional(),
  language_pref: Locale.default('fr-CA'),
});

export const UpdateUserInput = z.strictObject({
  email: Email.optional(),
  name: userName.optional(),
  phone: PhoneE164.nullable().optional(),
  language_pref: Locale.optional(),
  status: UserStatus.optional(),
});

/**
 * F-04 member view: a membership joined to its user, which is what a team
 * screen actually needs (who they are + what they can do). Never exposes
 * credentials — identity lives in Better Auth, this is the domain record.
 */
export const Member = z.object({
  id: Uuid,
  user_id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  roles: z.array(Role).min(1),
  status: MembershipStatus,
  email: Email,
  name: userName,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/**
 * Add a colleague by EMAIL (the user row is created if absent) — the org has
 * exactly one user until someone does this, so it is what makes assignment
 * demonstrable. `store_id: null` = the roles apply org-wide.
 */
/**
 * The add-member response. `reinstated` is true when the address already
 * belonged to a REVOKED/INVITED membership that was revived rather than a new
 * person being created — the team screen tells the admin which happened
 * (CR-01; the flag was lost in the HO-09 security rewrite).
 */
export const MemberAdded = Member.extend({
  reinstated: z.boolean().optional(),
});

export const AddMemberInput = z.strictObject({
  organization_id: Uuid,
  email: Email,
  name: userName,
  roles: z.array(Role).min(1),
  store_id: Uuid.nullable().optional(),
});

/** Change what a member can do, or revoke them. */
export const UpdateMemberInput = z.strictObject({
  roles: z.array(Role).min(1).optional(),
  status: MembershipStatus.optional(),
  store_id: Uuid.nullable().optional(),
});

export const MemberListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  /**
   * Omitted = active + invited (the working roster). Pass `revoked` to show
   * former colleagues so the team screen can offer "reinstate" (HO-06 — the
   * owner hit a one-way door: removing someone left no path back).
   */
  status: MembershipStatus.optional(),
});

export type MemberT = z.infer<typeof Member>;
export type MemberAddedT = z.infer<typeof MemberAdded>;
export type AddMemberInputT = z.infer<typeof AddMemberInput>;
export type UpdateMemberInputT = z.infer<typeof UpdateMemberInput>;

export const CreateMembershipInput = z.strictObject({
  user_id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  roles: z.array(Role).min(1),
  status: MembershipStatus.default('active'),
});

export const UpdateMembershipInput = z.strictObject({
  store_id: Uuid.nullable().optional(),
  roles: z.array(Role).min(1).optional(),
  status: MembershipStatus.optional(),
});

export type UserT = z.infer<typeof User>;
export type MembershipT = z.infer<typeof Membership>;
export type CreateUserInputT = z.infer<typeof CreateUserInput>;
export type CreateMembershipInputT = z.infer<typeof CreateMembershipInput>;
