# API Design

This document specifies the ReadyLoans API surface: REST conventions, resource naming, versioning, pagination/filtering/sorting, the error envelope, idempotency keys, inbound webhooks for lead providers (JSON + ADF/XML), HMAC-signed outbound webhooks, realtime channels and their authorization, and the OpenAPI contract. The API is Fastify v5 with contract-first ts-rest + Zod under `/api/v1` (ADR-003, ADR-016). Sections labeled **Current** document the legacy Express API for contrast; everything else is **Target**.

## Table of Contents

1. [Principles & Stack](#1-principles--stack)
2. [URL Structure & Resource Naming](#2-url-structure--resource-naming)
3. [Versioning & Deprecation](#3-versioning--deprecation)
4. [Standard Headers](#4-standard-headers)
5. [HTTP Methods & Status Codes](#5-http-methods--status-codes)
6. [Pagination](#6-pagination)
7. [Filtering & Sorting](#7-filtering--sorting)
8. [Error Envelope](#8-error-envelope)
9. [Idempotency Keys](#9-idempotency-keys)
10. [Inbound Webhooks (Lead Intake)](#10-inbound-webhooks-lead-intake)
11. [Outbound Webhooks](#11-outbound-webhooks)
12. [Webhook Signature Specification](#12-webhook-signature-specification)
13. [Realtime Channels](#13-realtime-channels)
14. [OpenAPI Contract](#14-openapi-contract)

---

## 1. Principles & Stack

| Principle | Rule |
|---|---|
| Contract-first | Every endpoint is defined in `packages/contracts` as a ts-rest contract with Zod request **and** response schemas before implementation; OpenAPI 3.1 is generated from the same source (ADR-003) |
| One validation source | Domain schemas/enums come from `packages/schemas`; `.passthrough()` is banned (ADR-016) |
| Tenant-scoped by construction | No endpoint accepts `tenant_id` in a body or query; tenancy comes from the session + validated `X-Store-Id` ([multi-tenancy.md §5](./multi-tenancy.md)) |
| No inline side effects | Handlers enqueue BullMQ jobs for email/SMS/PDF/AI/webhooks; the response never waits on a provider SDK (ADR-012/020) |
| Auth everywhere | Every `/api/v1` route requires an authenticated session except: `GET /api/v1/tenant/context` (branding subset), public credit-app submission, and `/api/auth/*`; liveness/readiness are the unversioned `/healthz`/`/readyz` probes outside `/api/v1` ([hosting-topology.md §5](../07-infrastructure/hosting-topology.md)). (**Current:** ~150 legacy endpoints are unauthenticated — none are migrated as-is, ADR-003) |
| Localized | `Accept-Language` (fallback: user profile → tenant default → `fr-CA`) localizes human-readable `message` fields; machine `code` fields are stable English tokens (ADR-019) |

**Current** route inventory for reference: 45 Express routers under `/api` (deals, users, email, delivery-checklists, sourced-units, dispatch, upload, reports, salespeople, contacts, stores, activity-events, search, tasks, notifications, bulk, clawback, inventory, work-orders, documents, lenders, wholesale, automation-rules, workflows, suppliers, expenses, leads + lead sub-resources, tags, assignment-rules, conversations, templates, appointments, duplicates, lost-reasons, analytics/win-loss, source-costs, analytics/source-roi, saved-filters, scoring-rules). The target v1 surface re-creates these behind auth + tenancy.

## 2. URL Structure & Resource Naming

```
https://{tenant-domain}/api/v1/{resource}[/{id}][/{sub-resource}]
https://in.readyloans.app/in/v1/leads/{tenantSlug}/{sourceKey}   # intake service
```

Rules:

1. Resources are **plural kebab-case nouns**: `/deals`, `/leads`, `/work-orders`, `/delivery-checklists`, `/saved-filters`.
2. IDs are UUIDs in path segments: `/deals/018f6b2a-…`.
3. Nesting is **one level max** and only for true ownership: `/leads/{leadId}/communications`, `/deals/{dealId}/submissions`, `/deals/{dealId}/documents`. Everything else filters at the collection root (`/appointments?lead_id=…`).
4. Action endpoints (non-CRUD state transitions) are `POST /{resource}/{id}/{verb}` and are the exception, not the norm: `POST /leads/{id}/convert`, `POST /deals/{id}/stage-transitions`, `POST /submissions/{id}/select`, `POST /work-orders/{id}/send`, `POST /dispatch-assignments/{id}/release`.
5. Reports/aggregates live under `/reports` and `/analytics`: `GET /analytics/win-loss`, `GET /analytics/source-roi`, `POST /reports/exports` (async job → document).

Core v1 resource map:

| Resource | Collection path | Notable sub-resources / actions |
|---|---|---|
| Deals | `/api/v1/deals` | `/stage-transitions`, `/submissions`, `/documents`, `/commission`, `/funding` |
| Leads | `/api/v1/leads` | `/communications`, `/activities`, `/tasks`, `/appointments`, `/convert`, `/assign` |
| Contacts | `/api/v1/contacts` | `/merge` |
| Inventory | `/api/v1/inventory` | `/photos`, `/aging`, `/garage-queue`, `/stats` |
| Work orders | `/api/v1/work-orders` | `/send`, `/complete` |
| Dispatch | `/api/v1/dispatch-assignments` | `/auto-assign`, `/release` |
| Conversations (AI) | `/api/v1/conversations` | `/messages`, `/handoff` |
| Documents | `/api/v1/documents` | `/generate` (async), signed download URLs |
| Admin (org) | `/api/v1/org/{stores,members,invitations,branding,settings,webhooks,lead-sources,api-keys}` | tenant self-administration |
| Platform | `/api/v1/platform/organizations` | platform-admin only (service surface) |
| Realtime | Socket.IO handshake on the `api.` host (`/socket.io`, WebSocket) | see §13 |
| Billing | `/api/v1/billing/{subscription,usage,portal-session}` | Stripe-backed (ADR-024) |

## 3. Versioning & Deprecation

- **URL versioning**: `/api/v1`. Breaking changes ship as `/api/v2`; the prior version is supported **≥6 months** after v2 GA (ADR-003).
- Non-breaking changes (new optional fields, new endpoints, new enum values on *output* only) land in-place. New enum values on **inputs** require contract review because Zod validation is strict.
- Deprecations are announced via response headers on affected endpoints:
  - `Deprecation: true`
  - `Sunset: Sat, 30 Jan 2027 00:00:00 GMT`
  - `Link: <https://developers.readyloans.app/changelog#v1-deals>; rel="deprecation"`
- Webhook payloads carry `api_version` so consumers can pin parsing behavior (§11).

## 4. Standard Headers

| Header | Direction | Semantics |
|---|---|---|
| `Cookie` (Better Auth session) | request | primary auth for the SPA (ADR-006) |
| `Authorization: Bearer rl_live_…` | request | tenant-scoped API keys for integrators (managed at `/org/api-keys`; hashed at rest, prefix-searchable) |
| `X-Store-Id` | request | working-store selector; validated against membership, `403` on mismatch |
| `Idempotency-Key` | request | see §9 |
| `Accept-Language` | request | `fr-CA` / `en-CA` |
| `X-Request-Id` | response | ULID `req_01J…`; echoed into logs, traces, and error envelopes |
| `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` | response | narrowest applicable bucket (ADR-011) |
| `Retry-After` | response (429/503) | seconds |
| `Deprecation` / `Sunset` | response | §3 |

## 5. HTTP Methods & Status Codes

| Method | Use | Success |
|---|---|---|
| `GET` | read; always safe/cacheable per-user | `200` |
| `POST` | create, actions, async job kickoff | `201` (resource, `Location` header), `202` (async job `{ job_id }`) |
| `PATCH` | partial update (JSON body validated by the entity's partial Zod schema) | `200` |
| `PUT` | full replacement — used only for settings-style documents (`/org/branding`) | `200` |
| `DELETE` | soft delete (`deleted_at`, ADR-009) | `204` |

Error statuses: `400` malformed request, `401` unauthenticated, `402` payment required (tenant `past_due` hard-gate on billable actions), `403` forbidden / tenant state, `404` not found (also returned for cross-tenant IDs — existence is never leaked), `409` conflict (uniqueness, idempotency replay mismatch, stale `updated_at` optimistic-lock), `413` payload too large, `422` validation failed, `429` rate limited, `500` internal, `503` dependency down.

## 6. Pagination

Cursor (keyset) pagination on every collection endpoint. Offset pagination is not offered.

Request:

```
GET /api/v1/deals?limit=50&cursor=eyJjIjoiMjAyNi0wNy0yMVQxNDowMzoyMloiLCJpZCI6IjAxOGY2YjJhIn0
```

| Param | Type | Default | Max |
|---|---|---|---|
| `limit` | int | 25 | 100 |
| `cursor` | base64url of `{c: <sort-key value>, id: <uuid>}` | — | opaque; issued by the server only |

Response envelope:

```json
{
  "data": [ { "id": "…", "…": "…" } ],
  "page": {
    "limit": 50,
    "has_more": true,
    "next_cursor": "eyJjIjoi…",
    "total_estimate": 1240
  }
}
```

- Cursors encode the active sort key + `id` tiebreaker; the underlying query is keyset (`WHERE (sort_key, id) < ($1, $2) ORDER BY sort_key DESC, id DESC LIMIT $3`) and must be covered by a composite index `(tenant_id, sort_key, id)`.
- `total_estimate` comes from a fast estimate (or cached count) — exact counts are only computed on `/stats` endpoints.
- Changing `sort` or filters invalidates a cursor; the server rejects mismatched cursors with `400 invalid_cursor`.

## 7. Filtering & Sorting

Filters are query params named after fields, with bracketed operators for non-equality:

```
GET /api/v1/deals?pipeline_stage[in]=new,approved&sale_price_cents[gte]=1000000
    &created_at[gte]=2026-07-01T00:00:00Z&salesperson_id=ea422f90-…&q=civic
```

| Operator | Meaning | Example |
|---|---|---|
| (none) | equality | `finance_status=approved` |
| `[in]` | any-of (comma list, ≤50 values) | `pipeline_stage[in]=new,approved` |
| `[gte]` / `[lte]` / `[gt]` / `[lt]` | range (numbers, ISO-8601 dates) | `created_at[gte]=…` |
| `[ne]` | not equal | `status[ne]=lost` |
| `[null]` | is-null test (`true`/`false`) | `assigned_to[null]=true` |
| `q` | full-text search (tsvector-backed, per-resource fields) | `q=tremblay` |

Rules:

- Filterable/sortable fields are **explicitly enumerated per contract** in `packages/contracts` (Zod-validated); unknown filter params are `400 unknown_filter`, not silently ignored.
- Money filters use `*_cents` integer fields (ADR-009).
- Soft-deleted rows are excluded by default; `include_deleted=true` is honored only for roles with the `records:restore` permission.

Sorting: `sort=-created_at,stock_number` — comma list, `-` prefix = descending, max 2 keys, every allowed key backed by a composite index. Default sort is `-created_at` unless the contract states otherwise (e.g., lead queue defaults to `-score,-created_at`).

## 8. Error Envelope

All non-2xx responses share one envelope (Zod-typed in `packages/contracts`, so the SPA gets typed errors):

```json
{
  "error": {
    "code": "validation_failed",
    "message": "La validation a échoué",
    "request_id": "req_01J2X9GQ4NV8",
    "details": [
      { "path": "customer.phone", "code": "invalid_phone", "message": "Le téléphone doit contenir 10 à 11 chiffres" },
      { "path": "vin", "code": "invalid_vin", "message": "Le NIV doit contenir 17 caractères (sans I, O, Q)" }
    ]
  }
}
```

| Field | Semantics |
|---|---|
| `code` | stable machine token — the contract; never localized, never renamed within a major version |
| `message` | human-readable, localized via `Accept-Language` (server-side i18next, ADR-019) |
| `request_id` | matches `X-Request-Id`; the support/debugging join key across pino logs, Sentry, and OTel traces (ADR-025) |
| `details[]` | present on `validation_failed` (one entry per Zod issue, dot-joined `path`) and on domain gate failures (e.g., delivery-readiness blockers) |

Canonical codes: `unauthorized`, `mfa_required`, `forbidden`, `tenant_read_only`, `tenant_suspended`, `not_found`, `conflict`, `stale_version`, `idempotency_conflict`, `validation_failed`, `unknown_filter`, `invalid_cursor`, `rate_limited`, `quota_exceeded`, `payload_too_large`, `dependency_unavailable`, `internal`.

Domain gate example — the pre-delivery hard block returns `422` with actionable details:

```json
{
  "error": {
    "code": "delivery_blocked",
    "message": "La livraison ne peut pas être planifiée",
    "request_id": "req_01J2XA71M3T0",
    "details": [
      { "path": "checklist.insurance_status", "code": "not_verified", "message": "Assurance non vérifiée" },
      { "path": "checklist.funding_status", "code": "not_funded", "message": "Financement non confirmé" }
    ]
  }
}
```

**Current** contrast: the legacy API returns ad-hoc `{ error: '…' }` strings and `{ error: 'Validation failed', details: [...] }` from Zod — the target envelope formalizes and localizes this shape.

## 9. Idempotency Keys

All unsafe `POST` endpoints (creates, actions, exports, AI-call initiation) accept `Idempotency-Key`:

| Aspect | Rule |
|---|---|
| Key format | client-generated ULID/UUIDv4, ≤255 chars |
| Storage | Valkey `t:{tenantId}:idem:{key}` → `{fingerprint, status, response}` — `fingerprint = sha256(method + path + body)` |
| TTL | 24 hours |
| First request | processed normally; final status + body stored |
| Replay, same fingerprint | stored response returned with header `Idempotency-Replayed: true` |
| Replay, different fingerprint | `409 idempotency_conflict` |
| Concurrent duplicate | second request blocks up to 5s on the in-flight marker, then returns the stored result or `409` |

The SPA sends a key automatically on every mutation (generated per user action, retried on network failure). Intake and webhook processing use deterministic BullMQ job IDs instead (§10, ADR-012) — the same at-least-once discipline at the queue layer.

## 10. Inbound Webhooks (Lead Intake)

Handled by `apps/intake` (ADR-005). Endpoint shape:

```
POST https://in.readyloans.app/in/v1/leads/{tenantSlug}/{sourceKey}
```

`sourceKey` resolves a per-tenant `lead_sources` row: `{id, tenant_id, store_id, provider ('meta','fluent_form','adf_email','generic_json','chat_widget'), secret, active}`.

| Aspect | Rule |
|---|---|
| Accepted content types | `application/json`; `application/xml` + `text/xml` (ADF 1.0); `multipart/form-data` (Resend Inbound relay) |
| Size limits | 256 KB JSON / 1 MB XML / 10 MB inbound-email (photos) — larger → `413` |
| ACK contract | `202 {"received": true, "intake_id": "in_01J2XB…"}` — signature check + size check + spool + enqueue only; **no parsing-dependent work before the ACK**; p99 < 1s, typical < 100ms (ADR-025) |
| Bad signature | `401` (logged, counted per source; source auto-paused after 100 consecutive failures) |
| Malformed payload | still `202`; payload quarantined in `lead_intake_raw.status='quarantined'` for operator review — a provider retry storm is never triggered by our parser |
| Dedupe | BullMQ deterministic job ID: `lead-intake:{tenantSlug}:{provider_lead_id || sha256(body)}` — provider redelivery collapses to one pipeline run |
| Consent | CASL basis recorded at intake: `implied_inquiry`, expiry `now() + 6 months` (ADR-022) |

Signature verification per provider:

| Provider | Mechanism |
|---|---|
| Meta Lead Ads | `X-Hub-Signature-256: sha256=<hex>` — HMAC-SHA256 of raw body with the app secret |
| Twilio (SMS/voice status + inbound) | `X-Twilio-Signature` — HMAC-SHA1 of full URL + sorted POST params with the auth token |
| Resend Inbound (ADF email, delivery photos) | svix headers: `svix-id`, `svix-timestamp`, `svix-signature` |
| Fluent Forms / generic JSON | `X-Intake-Signature: v1=<hex>` — HMAC-SHA256 of `{timestamp}.{body}` with the per-source secret (same scheme as our outbound, §12), ±5 min |

ADF/XML: the parser maps ADF 1.0 `<prospect>` to the canonical Lead envelope — `<customer><contact><name part="first">`, `<phone>`, `<email>` → contact fields; `<vehicle interest="buy" status="used"><year><make><model>` → `vehicle_interest`; `<provider><service>` → source attribution; `<vendor>` matched to the store. Example accepted fragment:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<?adf version="1.0"?>
<adf>
  <prospect status="new">
    <requestdate>2026-07-21T14:03:22-04:00</requestdate>
    <vehicle interest="buy" status="used"><year>2024</year><make>Kia</make><model>Sportage</model></vehicle>
    <customer><contact>
      <name part="first">Marie</name><name part="last">Tremblay</name>
      <phone type="voice">819-555-0142</phone><email>marie@example.com</email>
    </contact></customer>
    <provider><service>AutoTrader.ca</service></provider>
  </prospect>
</adf>
```

## 11. Outbound Webhooks

Tenant admins register endpoints at `POST /api/v1/org/webhooks` `{url, events[], description}` → returns the endpoint + a signing secret (shown once). Delivery is a BullMQ `webhook-delivery` queue job per event × endpoint (ADR-005).

Event envelope:

```json
{
  "id": "evt_01J2XC8R5T9Q",
  "type": "deal.stage_changed",
  "api_version": "v1",
  "created_at": "2026-07-21T18:03:22Z",
  "tenant_id": "018f6b2a-…",
  "store_id": "4edcf6fb-…",
  "data": { "deal_id": "…", "pipeline_stage": "pending_delivery", "changed_by": "…" },
  "previous": { "pipeline_stage": "approved" }
}
```

Event catalog (v1):

| Event | Emitted when |
|---|---|
| `lead.created` | canonical lead persisted after intake normalization |
| `lead.assigned` | routing/assignment completes |
| `lead.status_changed` | any of the 10 lead lifecycle states changes |
| `lead.converted` | `POST /leads/{id}/convert` creates the deal |
| `deal.created` / `deal.stage_changed` / `deal.funded` / `deal.delivered` | pipeline events |
| `appointment.booked` / `appointment.updated` / `appointment.cancelled` | incl. AI-booked appointments |
| `conversation.handoff_requested` | AI requests a human (`request_human` tool) |
| `document.generated` | immutable PDF snapshot stored (ADR-021) |
| `inventory.unit_created` / `inventory.status_changed` | stock movements |
| `org.provisioned` / `org.offboarding_started` | tenant lifecycle |

Delivery policy:

| Aspect | Rule |
|---|---|
| Success | any `2xx` within a 10s timeout |
| Retry schedule | 30s → 2m → 10m → 1h → 6h → 24h (6 retries, exponential, max 24h total per ADR-005), then the delivery goes to the `webhook-delivery:dlq` |
| Auto-disable | endpoint disabled on `410 Gone`, or after 7 consecutive days of failures; org admins notified |
| Ordering | not guaranteed — consumers must use `created_at` + event `id`; events are at-least-once, consumers dedupe on `id` |
| Delivery log | per-tenant UI + `GET /api/v1/org/webhooks/{id}/deliveries` (status, attempts, response codes, next retry); manual redeliver button |

## 12. Webhook Signature Specification

Applies to all outbound webhooks (and the generic inbound scheme):

```
signed_payload = "{X-ReadyLoans-Timestamp}." + raw_body
X-ReadyLoans-Signature: v1=HEX(HMAC_SHA256(secret, signed_payload))
X-ReadyLoans-Timestamp: 1784829802          # unix seconds
```

Verification requirements for consumers:

1. Reject if `|now - timestamp| > 300s` (±5-minute replay window).
2. Compute HMAC over the **raw** body bytes (before JSON parsing) and compare constant-time.
3. During secret rotation the header carries both signatures (`v1=<new>,v1=<old>`); accept if **any** matches. Old secrets expire 72h after rotation (dual-secret rotation, ADR-005).

Reference verification (Node):

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(sigHeader: string, ts: string, rawBody: Buffer, secret: string): boolean {
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return sigHeader.split(",").some((part) => {
    const candidate = Buffer.from(part.replace("v1=", ""), "hex");
    return candidate.length === 32 && timingSafeEqual(candidate, Buffer.from(expected, "hex"));
  });
}
```

## 13. Realtime Channels

Socket.IO 4 + `@socket.io/redis-adapter` (on ElastiCache Valkey) is the primary realtime transport (ADR-004), served by the `apps/api` tasks behind the ALB — WebSocket upgrade on the `api.` host, path `/socket.io`. There is no database change-capture: events are emitted by the API/worker layer in the same code paths that commit the writes, so every payload carries exactly the fields the UI needs.

Authentication happens at the Socket.IO handshake: the browser presents the Better Auth session cookie (same origin as `/api/v1`); the server verifies the session, resolves the tenant + memberships, and pins `{tenant_id, store_ids, user_id}` to the connection. Every room join is authorized against that server-side context — client-supplied room names are never trusted, cross-tenant joins are rejected, and session revocation disconnects the socket.

| Room (channel) | Kind | Payload | Consumers |
|---|---|---|---|
| `tenant:{tenantId}:store:{storeId}:deals` | write-event (`deals`) | changed deal (contract-shaped summary) | kanban board, deal lists |
| `tenant:{tenantId}:store:{storeId}:leads` | write-event (`leads`) | changed lead | lead queue, speed-to-lead timers |
| `tenant:{tenantId}:user:{userId}:notifications` | write-event (`notifications`) | notification row | bell/toasts |
| `tenant:{tenantId}:presence:agents` | presence (heartbeats + Valkey) | `{user_id, store_id, status, last_seen}` | AI routing availability, team board |
| `tenant:{tenantId}:conversation:{conversationId}` | stream (worker-emitted) | AI token stream chunks, typing, handoff events | agent console, F&I live-analysis panel |

Rules:

- Room names are always prefixed `tenant:{tenantId}:` — enforced at join time and by the lint-guarded emit helper in `packages/contracts` that all emitters must use, which requires a tenant-scoped payload. Authorization lives entirely at join/emit time — there is no RLS backstop on the stream (ADR-004).
- API emits happen in the same service-layer path as the committed write; workers emit through `@socket.io/redis-emitter` on the same Valkey — no HTTP hop. The SPA never emits to data rooms (presence heartbeats excepted).
- AI token streaming to the agent console may alternatively use SSE from `apps/api` (`GET /api/v1/conversations/{id}/stream`) — same payload contract (ADR-004).
- Scaling posture (ALB stickiness, idle timeout, adapter fan-out) is specified in [scalability-performance.md §10](./scalability-performance.md). Supabase Realtime — the previous primary — was superseded 2026-07-24 and remains only as a considered alternative (ADR-004); the room naming and auth contract were preserved in the promotion.

## 14. OpenAPI Contract

- **Source of truth:** ts-rest contracts in `packages/contracts` (Zod request/response schemas). OpenAPI **3.1** is generated (`@ts-rest/open-api`) — never hand-edited.
- **Published at:** `GET /api/v1/openapi.json` (auth-free) + reference docs UI at `https://developers.readyloans.app` for integrators.
- **CI gate (ADR-023):** the pipeline regenerates the spec and fails on uncommitted diff; a breaking-change detector (`oasdiff`) blocks removals/type-narrowing within v1.
- **Contract snippet** (pattern every endpoint follows):

```ts
// packages/contracts/src/deals.ts
import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { DealSchema, DealCreateSchema, PipelineStageEnum } from "@readyloans/schemas";
import { ErrorEnvelope, page, cursorQuery } from "./shared";

const c = initContract();

export const dealsContract = c.router({
  listDeals: {
    method: "GET",
    path: "/api/v1/deals",
    query: cursorQuery.extend({
      "pipeline_stage[in]": z.string().optional(),   // CSV of PipelineStageEnum
      "created_at[gte]": z.string().datetime().optional(),
      salesperson_id: z.string().uuid().optional(),
      sort: z.enum(["-created_at", "created_at", "-sale_price_cents"]).default("-created_at"),
    }),
    responses: { 200: page(DealSchema), 401: ErrorEnvelope, 403: ErrorEnvelope },
  },
  createDeal: {
    method: "POST",
    path: "/api/v1/deals",
    headers: z.object({ "idempotency-key": z.string().max(255).optional() }),
    body: DealCreateSchema,                          // strict — no .passthrough() (ADR-016)
    responses: { 201: DealSchema, 409: ErrorEnvelope, 422: ErrorEnvelope },
  },
  transitionStage: {
    method: "POST",
    path: "/api/v1/deals/:dealId/stage-transitions",
    body: z.object({ to_stage: PipelineStageEnum, note: z.string().max(2000).optional() }),
    responses: { 201: DealSchema, 422: ErrorEnvelope },
  },
});
```

The SPA consumes the generated ts-rest client (tRPC-grade type safety); external integrators consume the OpenAPI 3.1 document with tenant-scoped API keys (§4).
