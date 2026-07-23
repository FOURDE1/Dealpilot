import { z } from 'zod';
import { Email, IsoDateTime, Locale, PhoneE164, Uuid } from './common.js';
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
