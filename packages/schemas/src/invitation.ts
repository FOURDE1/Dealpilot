import { z } from 'zod';
import { CursorQuery, Email, IsoDateTime, Uuid } from './common.js';
import { Role } from './roles.js';

/**
 * F-12 invitations (D-035). Adding a team member used to create a roster row
 * against an invented id and send nothing, so an invited person could never log
 * in. An invitation is now the roster entry until a real person accepts it.
 */

export const CreateInvitationInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid.optional(),
  email: Email,
  name: z.string().trim().min(1).max(120).optional(),
  roles: z.array(Role).min(1),
});

export const Invitation = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  email: z.string(),
  name: z.string().nullable(),
  roles: z.array(Role),
  invited_by: Uuid.nullable(),
  expires_at: IsoDateTime,
  accepted_at: IsoDateTime.nullable(),
  accepted_user_id: Uuid.nullable(),
  revoked_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  /**
   * Present exactly once, in the response that creates the invitation, and only
   * when email delivery is unavailable — never stored, never returned again.
   */
  accept_url: z.string().optional(),
});

/**
 * What the accept screen may show BEFORE anyone is authenticated: enough to say
 * "Groupe Hassan invited you as a salesperson", and nothing more. No member
 * list, no counts, no other invitations.
 */
export const InvitationPreview = z.object({
  organization_name: z.string(),
  email: z.string(),
  roles: z.array(Role),
});

export const InvitationListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
});

export type InvitationT = z.infer<typeof Invitation>;
export type InvitationPreviewT = z.infer<typeof InvitationPreview>;
export type CreateInvitationInputT = z.infer<typeof CreateInvitationInput>;
