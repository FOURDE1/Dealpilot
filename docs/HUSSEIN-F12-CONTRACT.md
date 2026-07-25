# F-12 invitations — API contract for the invite + accept screens (AHMAD → HUSSEIN)

Backend merged on `develop`. Schemas in `@dealpilot/schemas`
(`packages/schemas/src/invitation.ts`): `CreateInvitationInput`, `Invitation`,
`InvitationPreview`. Contract: `apiV1.invitations`.

## Why this exists

Adding a member used to write a roster row against an invented id and send
nothing — that person could never log in, and if they signed up on their own
they got an unrelated account. This is D-035, option A, decided by delegation
while the owner was asleep. It is logged in `docs/OWNER-DECISIONS-PENDING.md`
and is reversible if he disagrees.

## Endpoints

| Method | Path | Auth | Returns |
|---|---|---|---|
| POST | `/api/v1/invitations` | owner/gm/admin_office | the `Invitation` |
| GET | `/api/v1/invitations` | owner/gm/admin_office | paginated open invitations |
| POST | `/api/v1/invitations/preview` | **PUBLIC** | `InvitationPreview` |
| POST | `/api/v1/invitations/accept` | any session | `{organization_id, membership_id}` |
| DELETE | `/api/v1/invitations/:id` | owner/gm/admin_office | 204 |

## The two screens

### 1. Team → Invite

`POST /api/v1/invitations` with `{organization_id, email, roles[], store_id?, name?}`.

- **The response never contains the token.** The link goes to the invitee by
  email. Do not try to display or copy it.
- **One exception:** if email delivery failed, the response carries
  `accept_url`. Show it then — with a line saying the email did not go out, so
  the owner can pass the link on himself rather than being stuck. If
  `accept_url` is absent, the mail was sent.
- **409 `already_member`** — that person is already on the team.
- **403** — you cannot invite above your own roles (a gm cannot invite an owner).
- Re-inviting the same email replaces the previous open invitation, so "resend"
  is just this endpoint again.

**The roster must show invited people.** They are NOT in `/api/v1/members` yet —
they have no membership until they accept. Merge `GET /api/v1/invitations` into
the Team list with status **Invited**, visually distinct from Active, with a
"Revoke" action (`DELETE /api/v1/invitations/:id`).

**A consequence to surface, not hide:** an invited person cannot be assigned
leads, because they do not exist as a user yet. Leave them out of assignee
pickers. If that reads as broken to the owner, that is D-035 and we switch — but
do not paper over it by showing a name that cannot be selected.

### 2. `/invitations/:token` — the accept screen

The email links to **the web app** at `/invitations/<token>`. Read the token from
the URL, then:

1. `POST /api/v1/invitations/preview` with `{token}` — **no session needed**.
   Returns `{organization_name, email, roles}`. Render "Groupe Hassan invited you
   to join as Salesperson". A 404 means unknown, expired, revoked or already
   used — all the same message: "This invitation is no longer valid."
2. The person signs up (or signs in) **with the email shown**. Prefill it and
   make clear it must be that address.
3. `POST /api/v1/invitations/accept` with `{token}` and their session.
   - **403 `wrong_account`** — signed in as someone else. Say so plainly:
     "This invitation was sent to marc@example.com — sign in as that address."
     This is not an edge case; forwarded links are normal.
   - **404** — the link was used or expired between steps 1 and 3.
   - **201** — done. Send them to the app; they are a member now.

**Never put the token in a URL you call.** It travels in the body on purpose:
tokens in paths land in access logs, browser history and Referer headers, and
this one grants a seat in someone's business. The web route may hold it (the
email link has to point somewhere) but strip it from the address bar after
reading it if that is cheap for you.

## New error codes for your FR/EN map

`already_member` · `wrong_account` · `organization_required` · plus the existing
`forbidden`, `validation_failed`, `not_found`.

## Also landed: CR-04 is closed

`GET /api/v1/activity?entity_id=<dealId>` now returns what happened **to** that
deal and what happened **under** it — its checklist acts included. You can drop
the client-side filtering over org-wide checklist events. Events carry
`parent_entity_type` / `parent_entity_id`; the same roll-up will work for
dispatch and documents without a new endpoint.

## Anything unclear

File a CR row in `docs/TASKS.md`. CR-03 and CR-04 were both right and both found
real design gaps.
