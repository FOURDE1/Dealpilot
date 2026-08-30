-- 0069 — per-tenant usage, the tenant snapshot, and the job register (F-73;
-- admin-console.md §6, §9, §11, §12; analytics-and-adoption.md §5.3, §6;
-- ADR-009/011/016; D-074).
--
-- ---------------------------------------------------------------------------
-- THIS MIGRATION CREATES NO TABLE AND NO COLUMN.
-- ---------------------------------------------------------------------------
-- §6 sources every usage number from a `usage_counters` rollup fed by an
-- hourly Valkey flush. That table is not created here, and the reason is the
-- reason the spec itself budgets a nightly reconciler: a counter is a SECOND
-- source of truth, and it drifts from the rows it claims to count. The
-- reconciler is not in this slice, so the drift would be silent — and the
-- write path is keyed on REDIS_URL, which is `z.string().optional()`
-- (apps/api/src/env.ts:56), unset on every developer machine and in CI's
-- `checks` job. A counter reading zero because Redis was absent is
-- indistinguishable from a tenant that did nothing, which is the exact class
-- of lie this console exists to stop telling.
--
-- Every §6 number that has a producer is therefore aggregated at READ time,
-- from `leads`, `deals`, `messages`, `memberships`, `activity_events`,
-- `deal_documents`, `stores` and `plans` — rows that ARE the truth — inside one
-- STABLE SECURITY DEFINER, over a window capped at 90 days.
--
-- UN-CUT CONDITION, verbatim: the day a read of `admin_tenant_usage` exceeds
-- its budget on a real tenant, or the day Stripe Meters need a mirror to
-- reconcile against, a rollup table lands WITH its `usage-flush` job AND its
-- `usage-reconcile` job — never one without the other two.
--
-- ---------------------------------------------------------------------------
-- No organization_id, no new RLS surface
-- ---------------------------------------------------------------------------
-- This migration's own objects are three functions and six indexes. It adds no
-- table, so `rls-coverage.test.ts` conscripts nothing new, and the definers
-- read tenant tables as their OWNER exactly as 0065-0068's do
-- (definer-owner.test.ts is the standing check on that dependency).
--
-- ---------------------------------------------------------------------------
-- Indexes: six, and why each metric needs one
-- ---------------------------------------------------------------------------
-- Each is commented with the SINGLE metric it serves. Two of them exist
-- because of a metering decision worth stating: `leads_created` and
-- `deals_created` count rows INCLUDING those soft-deleted later — deleting a
-- lead does not un-ingest it, and a usage figure that moves backwards is not a
-- usage figure. Every existing keyset index on those tables is PARTIAL on
-- `deleted_at IS NULL`, so none of them can serve an all-rows count. That is
-- two extra indexes on two hot tables, bought to stop a number changing
-- retroactively.
--
-- ---------------------------------------------------------------------------
-- Error contract additions (SQLSTATE → HTTP in apps/api/src/platform.ts)
-- ---------------------------------------------------------------------------
--   None. No new SQLSTATE is minted, and apps/api/src/platform.ts is not
--   edited.
--
--   0068's header states the rule: one SQLSTATE maps to exactly one AppError,
--   so a refusal that already has a code reuses it. Tenant-not-found is PA002
--   → 404, as `admin_get_tenant`. A role refusal is PA009 → 403, raised by
--   `platform_assert_actor`. A missing reason is the generic 23514 → 422 on
--   path `reason`. The three caller-bug belts below — an unknown period, a
--   name that is not queue-shaped, an empty id list — reuse PA014, which is
--   already this schema's caller-bug code and is deliberately unmapped ⇒ 500
--   (20260827000066:33, raised at :175 and :296, and 20260827000067:255).
--   PA027 is left free for a refusal that actually needs an HTTP mapping.
--
--   CAVEAT on 23514, because "none" without it would be an incomplete
--   statement about the one path that WILL fire if the lockstep below breaks:
--   23514 is a BLANKET map in apps/api/src/platform.ts:160-163 — ANY
--   check-constraint violation raised inside ANY definer surfaces as 422
--   `validation_failed` / "Reason required" on path `reason`. That is
--   deliberate for the missing-reason belt. It also means that if the widened
--   `platform_audit_events_event_check` and the INSERT literal below ever
--   disagree — a code deploy ahead of this migration — the operator is told
--   "Reason required" rather than anything about the event vocabulary.
--   `PLATFORM_AUDIT_EVENTS` and this CHECK ship in ONE commit for exactly that
--   reason.
--
-- ---------------------------------------------------------------------------
-- The queue vocabulary is NOT in this schema
-- ---------------------------------------------------------------------------
-- `admin_record_queue_retry` takes the queue name as text and checks its
-- SHAPE, not its membership. The catalogue is BullMQ's and lives in
-- packages/contracts/src/queues.ts, where the API and the workers both read
-- it; a CHECK here would be a third copy able to drift from the two that
-- matter, and a queue rename would need a migration to file an audit row. The
-- route validates the name against `QueueName` and answers 404 before this is
-- ever called, so a bad name arriving here is a code bug — which is what
-- PA014 means.

-- ---------------------------------------------------------------------------
-- 1. Indexes — one metric each
-- ---------------------------------------------------------------------------

-- leads_created. Counts every lead row created in the window, soft-deleted
-- ones included; idx_leads_org_keyset is partial on deleted_at and cannot
-- serve that count, not as a scan and not as a prefix.
CREATE INDEX idx_leads_org_created ON leads (organization_id, created_at);

-- ai_first_touch_p95_seconds (and its sample count). Partial, because a lead
-- the assistant never greeted is not in the sample.
CREATE INDEX idx_leads_org_engaged ON leads (organization_id, chatbot_engaged_at)
  WHERE chatbot_engaged_at IS NOT NULL;

-- deals_created. Same all-rows reason as leads: the existing deal indexes are
-- partial on deleted_at.
CREATE INDEX idx_deals_org_created ON deals (organization_id, created_at);

-- deals_delivered.
CREATE INDEX idx_deals_org_delivered ON deals (organization_id, delivered_at)
  WHERE delivered_at IS NOT NULL;

-- members_who_acted. NOT ONE of the six indexes activity_events already
-- carries is keyed on created_at — every one of them is keyed on `seq`, and
-- seq is insertion order rather than clock time, so a 90-day created_at window
-- would scan every event the tenant has ever written. Enumerated so the claim
-- stays checkable: idx_activity_entity and idx_activity_org_recent and
-- idx_activity_actor (0014:67-70), idx_activity_parent (0016:24),
-- idx_activity_platform (0065:251), idx_activity_impersonation (0067:135).
-- Five sort seq DESC; idx_activity_impersonation sorts seq ASC and is not even
-- organization-prefixed, so it could not serve a per-tenant window under any
-- ordering. (`grep -n "ON activity_events" packages/db/migrations/*.sql` is the
-- whole population — the only DROP INDEX in the tree is idx_deals_org_status.)
-- actor_user_id rides along as a third key column so count(DISTINCT …) can be
-- an index-only scan on the tenant's largest table. No `actor_user_id IS NOT
-- NULL` conjunct: activity_events_actor_consistency (0065:235) already makes
-- actor_type = 'tenant' imply it, so the extra clause would buy nothing.
CREATE INDEX idx_activity_org_tenant_created
  ON activity_events (organization_id, created_at, actor_user_id)
  WHERE actor_type = 'tenant';

-- document_bytes — an index-only scan. The existing idx_deal_documents_org_status
-- is PARTIAL on deleted_at and carries `status`, so it serves neither this sum
-- nor an all-rows one. Unlike leads and deals the honest predicate here IS
-- `deleted_at IS NULL`: a deleted document frees storage, where a deleted lead
-- was still ingested.
CREATE INDEX idx_deal_documents_org_bytes
  ON deal_documents (organization_id) INCLUDE (size_bytes)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. admin_tenant_usage (§6) — the card, computed from rows
-- ---------------------------------------------------------------------------
--
-- Aliases are stable and unique per table (l, d, m, mb, a, dd, s, pl), because
-- apps/api/src/usage-metric-drift.test.ts proves each metric's claimed
-- table.column is really READ here by matching `alias.column` against
-- pg_get_functiondef. A shared alias would make that proof ambiguous.
--
-- Soft-deleted tenants still answer, consistently with admin_get_tenant
-- (0066:135); `readAdminTenant` already closes their transitions.
--
-- `document_bytes` and `sms_segments` are bigint: node-postgres returns int8 as
-- a STRING, so the route converts with Number(), the f69-admin-routes.ts:150
-- `seq` precedent.
CREATE FUNCTION admin_tenant_usage(p_actor uuid, p_org uuid, p_period text)
RETURNS TABLE (
  window_start timestamptz, window_end timestamptz,
  plan_code text,
  seats_provisioned integer, member_count integer, store_count integer,
  document_bytes bigint,
  members_who_acted integer, leads_created integer, deals_created integer,
  deals_delivered integer, ai_conversations_engaged integer,
  sms_segments bigint, sms_messages_unsegmented integer,
  ai_first_touch_p95_seconds integer, ai_first_touch_sample_count integer,
  included_seats integer, included_sms_segments integer, included_ai_conversations integer
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_from             timestamptz;
  v_to               timestamptz := now();
  v_plan_code        text;
  v_included_seats   integer;
  v_included_sms     integer;
  v_included_ai      integer;
BEGIN
  PERFORM platform_assert_actor(p_actor,
    ARRAY['platform_super_admin','platform_support','platform_billing']);

  -- The window is the platform's operating timezone — the same default
  -- stores.timezone carries — and it is RETURNED, so no figure is ever read
  -- without the period it belongs to.
  v_from := CASE p_period
    WHEN 'mtd' THEN date_trunc('month', v_to AT TIME ZONE 'America/Montreal')
                   AT TIME ZONE 'America/Montreal'
    WHEN '30d' THEN v_to - interval '30 days'
    WHEN '90d' THEN v_to - interval '90 days'
    ELSE NULL END;
  IF v_from IS NULL THEN
    -- Belt: the route parses the enum before calling, so reaching this is a
    -- caller bug rather than something a client can ask for.
    RAISE EXCEPTION 'unknown usage period %', p_period USING ERRCODE = 'PA014';
  END IF;

  -- What the tenant BOUGHT. Three of the plan's five included_* columns are
  -- read; included_ai_minutes and included_storage_gb are deliberately never
  -- touched here, which is what usage-metric-drift.test.ts's
  -- DEAD_PLAN_ALLOWANCES check reads this definition to establish.
  SELECT pl.code, pl.included_seats, pl.included_sms_segments, pl.included_ai_conversations
    INTO v_plan_code, v_included_seats, v_included_sms, v_included_ai
    FROM plans pl JOIN organizations o ON o.plan_id = pl.id
   WHERE o.id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'PA002';
  END IF;

  RETURN QUERY
  WITH sms AS (
    -- The channel filter is not cosmetic: messages.channel permits
    -- 'voice_transcript' and 'web_chat', and neither is something a carrier
    -- ever counted segments for. Without it a web-chat reply would land in
    -- "SMS the carrier never segmented" and the card would report a fake
    -- undercount.
    SELECT COALESCE(sum(m.segments), 0)                        AS segments,
           count(*) FILTER (WHERE m.segments IS NULL)::integer AS unsegmented
      FROM messages m
     WHERE m.organization_id = p_org
       AND m.direction = 'outbound'
       AND m.channel IN ('sms','mms')
       AND m.created_at >= v_from AND m.created_at < v_to
  ),
  first_touch AS (
    -- percentile_disc, not percentile_cont: a p95 that some lead really
    -- experienced, never an interpolated value nobody did.
    --
    -- Three restrictions, all of which the caption repeats. The lead must have
    -- been CREATED in the window too, or a lead created in March and
    -- re-engaged in August inflates August. And `c.lead_id = l.id` is what
    -- makes the name `ai_first_touch` true: first-touch.ts stamps
    -- chatbot_engaged_at on two paths that send THIS lead no message at all —
    -- the 24-hour dedupe path (:165-171) sends nothing, and the
    -- duplicate-as-signal path (:238-243) stamps this lead while messaging the
    -- KEEPER's thread, whose conversation carries the keeper's lead_id. Both
    -- are excluded by the join key alone.
    --
    -- There is deliberately NO `m.created_at <= l.chatbot_engaged_at` ordering
    -- clause, and it must not be re-added: the two timestamps are written in
    -- the opposite order to the one it assumes. first-touch.ts:246 captures
    -- `now` in JS BEFORE staging; the message row takes `DEFAULT now()` at
    -- INSERT (0031:89), later; and only after the carrier returns does :425
    -- stamp chatbot_engaged_at with that EARLIER value. So on every normal
    -- greeting the message is strictly newer than the stamp, and such a clause
    -- empties the sample for exactly the tenants whose first touch works.
    --
    -- KNOWN EXCLUSION, disclosed in the caption rather than fixed here: a
    -- greeting HELD FOR QUIET HOURS is delivered and still never enters this
    -- sample. When sendMessage answers `deferred`, first-touch.ts:358-373
    -- returns before the stamp block at :420-429, and deferred-send.ts — which
    -- does deliver the greeting — writes to conversations, messages and
    -- send_decisions and never to leads, so chatbot_engaged_at stays NULL
    -- permanently. The row then dies on the window predicates at the WHERE
    -- below, before the EXISTS that would have matched its delivered message is
    -- ever evaluated. Those are the SLOWEST greetings (22:00 in, 09:00 out), so
    -- dropping them biases this p95 FAST for precisely the tenants who turned
    -- tenant_comms_config.first_touch_quiet_exempt off (0028:228, which
    -- defaults it true; compliance-quiet-hours.ts:273-295 is the only path that
    -- can answer `deferred` for a first_touch). Not corrected in SQL because
    -- there is nothing here to correct: the metric is defined on
    -- chatbot_engaged_at, and no timestamp on this row records the held
    -- delivery. Un-cut: the day deferred-send.ts stamps chatbot_engaged_at
    -- when it actually sends — that repairs the SLA column for every consumer,
    -- not just this card, and this comment and both captions come out together.
    SELECT percentile_disc(0.95) WITHIN GROUP (
             ORDER BY extract(epoch FROM (l.chatbot_engaged_at - l.created_at))) AS p95,
           count(*)::integer AS sample
      FROM leads l
     WHERE l.organization_id = p_org
       AND l.chatbot_engaged_at >= v_from AND l.chatbot_engaged_at < v_to
       AND l.created_at         >= v_from AND l.created_at         < v_to
       AND EXISTS (SELECT 1
                     FROM conversations c
                     JOIN messages m ON m.organization_id = c.organization_id
                                    AND m.conversation_id = c.id
                    WHERE c.organization_id = l.organization_id
                      AND c.lead_id = l.id
                      AND m.direction = 'outbound'
                      AND m.sender_type = 'bot')
  )
  SELECT
    v_from,
    v_to,
    v_plan_code,
    -- memberships is UNIQUE (user_id, organization_id, store_id) and the
    -- members route writes one row per store, so a GM at three rooftops is
    -- three rows and ONE seat.
    (SELECT count(DISTINCT mb.user_id)::integer FROM memberships mb
      WHERE mb.organization_id = p_org AND mb.status = 'active'),
    -- member_count and store_count are admin_get_tenant's own SQL (0066:114-115),
    -- repeated rather than renamed, so the usage card and the tenant page
    -- cannot print two different numbers for one fact.
    (SELECT count(*)::integer FROM memberships mb
      WHERE mb.organization_id = p_org AND mb.status = 'active'),
    (SELECT count(*)::integer FROM stores s
      WHERE s.organization_id = p_org AND s.deleted_at IS NULL),
    -- Documents only, and only the ones that still exist. deal_documents.size_bytes
    -- is the sole byte column in this schema — branding assets record keys with
    -- no size — so the gauge is named for what it counts.
    (SELECT COALESCE(sum(dd.size_bytes), 0) FROM deal_documents dd
      WHERE dd.organization_id = p_org AND dd.deleted_at IS NULL),
    -- The dau/wau/mau substitute, and a FLOOR: activity_events is a mutation
    -- log, so somebody who only reads writes no row. Restricted to people who
    -- hold access TODAY, because otherwise a salesperson revoked on day 20 of
    -- a 30-day window would be counted here and not in seats_provisioned, and
    -- the two adjacent numbers would be drawn from different populations.
    -- EXISTS, not a JOIN: this is a semi-join, and writing it as an inner join
    -- multiplies the scanned rows by the person's rooftop count before
    -- count(DISTINCT) throws the duplicates away. memberships is UNIQUE
    -- (user_id, organization_id, store_id) and the members route writes one row
    -- per store, so the join key (user_id, organization_id) is NOT unique.
    -- Measured on a scratch replica (1M activity_events over 4 orgs, every user
    -- holding six active memberships, 20,537 events in the 30-day window): the
    -- join emits 123,222 rows from the 20,537 the index-only scan read — a
    -- clean 6x, the rooftop count — and sorts all of them (22.6-23.5 ms);
    -- the EXISTS hash-aggregates memberships first, sorts 20,537, and runs in
    -- 7.3-8.2 ms on identical buffers (shared hit=211 both ways) for an
    -- identical answer. At one membership per user the two are the same plan
    -- and the same 8 ms, so the semi-join never loses — it only stops the
    -- fan-out from throwing away what idx_activity_org_tenant_created bought.
    (SELECT count(DISTINCT a.actor_user_id)::integer
       FROM activity_events a
      WHERE a.organization_id = p_org
        AND a.actor_type = 'tenant'
        AND a.created_at >= v_from AND a.created_at < v_to
        AND EXISTS (SELECT 1 FROM memberships mb
                     WHERE mb.user_id = a.actor_user_id
                       AND mb.organization_id = a.organization_id
                       AND mb.status = 'active')),
    -- No deleted_at filter, deliberately (see the index header).
    (SELECT count(*)::integer FROM leads l
      WHERE l.organization_id = p_org
        AND l.created_at >= v_from AND l.created_at < v_to),
    (SELECT count(*)::integer FROM deals d
      WHERE d.organization_id = p_org
        AND d.created_at >= v_from AND d.created_at < v_to),
    (SELECT count(*)::integer FROM deals d
      WHERE d.organization_id = p_org
        AND d.delivered_at >= v_from AND d.delivered_at < v_to),
    -- Conversations the assistant actually spoke in, counted once each however
    -- many turns it took.
    (SELECT count(DISTINCT m.conversation_id)::integer FROM messages m
      WHERE m.organization_id = p_org
        AND m.direction = 'outbound' AND m.sender_type = 'bot'
        AND m.created_at >= v_from AND m.created_at < v_to),
    sms.segments,
    sms.unsegmented,
    -- NULL stays NULL. GREATEST() IGNORES nulls — GREATEST(0, NULL) is 0 — so
    -- clamping an empty sample directly would report a p95 of zero seconds for
    -- a tenant the assistant never greeted, which reads as instant service.
    -- The clamp itself is still needed: leads carries no CHECK ordering
    -- chatbot_engaged_at against created_at, and a provider-supplied timestamp
    -- could otherwise produce a negative epoch that fails the response schema
    -- as a 500.
    CASE WHEN first_touch.p95 IS NULL THEN NULL
         ELSE GREATEST(0, first_touch.p95)::integer END,
    -- A p95 over three leads is noise; a number without its sample size is a
    -- claim without its evidence.
    first_touch.sample,
    v_included_seats,
    v_included_sms,
    v_included_ai
  FROM sms, first_touch;
END $$;
REVOKE ALL ON FUNCTION admin_tenant_usage(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_tenant_usage(uuid, uuid, text) TO dealpilot_app;

COMMENT ON FUNCTION admin_tenant_usage(uuid, uuid, text) IS
  'Per-tenant usage for one window (admin-console.md §6). Computed from business rows at read time; F-73 creates no usage_counters table — see the 0069 header for the un-cut condition. Any platform role may read it (tenants:read).';

-- ---------------------------------------------------------------------------
-- 3. admin_tenant_snapshot (§9) — everything admin_get_tenant does NOT return
-- ---------------------------------------------------------------------------
--
-- The route spreads readAdminTenant() and merges this on top, so the tenant's
-- identity, plan, status, stores and counts have exactly ONE producer. This
-- function deliberately re-implements none of them.
--
-- The store array is `store_health`, never `stores`: AdminTenantDetail.stores
-- already exists with different members (0066:118-122), and a second array
-- under the same name with a different shape is how two screens start
-- disagreeing in public.
--
-- Not here, and cut by name: a deploy version. schema_migrations is a SCHEMA
-- version, it is global, it is created ad hoc by the migration runner with no
-- GRANT, and there is no deploy pipeline for it to describe — putting it on a
-- TENANT card would invite "this tenant is on…". Un-cut the day the API
-- exposes a build identifier.
CREATE FUNCTION admin_tenant_snapshot(p_actor uuid, p_org uuid)
RETURNS TABLE (
  seats_provisioned integer,
  store_health jsonb,
  intake_keys jsonb,
  comms_config jsonb,
  branding_state text, branding_version integer, branding_published_at timestamptz,
  connectors_active integer
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor,
    ARRAY['platform_super_admin','platform_support','platform_billing']);
  PERFORM 1 FROM organizations o WHERE o.id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'PA002';
  END IF;

  RETURN QUERY
  WITH traffic AS (
    -- messages carries no store_id, so per-store attribution goes through the
    -- conversation. The window is thirty days and the block that carries these
    -- numbers says so in both locales, because `last_message_at` inside a
    -- thirty-day block must not be read as "ever".
    SELECT c.store_id,
           count(*) FILTER (WHERE m.direction = 'inbound')::integer  AS inbound,
           count(*) FILTER (WHERE m.direction = 'outbound')::integer AS outbound,
           count(*) FILTER (WHERE m.delivered)::integer              AS delivered,
           max(m.created_at)                                         AS last_message_at
      FROM conversations c
      JOIN messages m ON m.organization_id = c.organization_id
                     AND m.conversation_id = c.id
     WHERE c.organization_id = p_org
       AND m.created_at >= now() - interval '30 days'
     GROUP BY c.store_id
  ),
  -- One row whether or not the tenant has an org-level row: the unique indexes
  -- on tenant_comms_config and tenant_branding (org-level, not deleted) make
  -- the LEFT JOIN at most one match.
  comms AS (
    SELECT jsonb_build_object(
             'org_row_present', cc.id IS NOT NULL,
             'store_overrides', (SELECT count(*)::integer FROM tenant_comms_config sc
                                  WHERE sc.organization_id = p_org
                                    AND sc.store_id IS NOT NULL
                                    AND sc.deleted_at IS NULL),
             'sms_quiet_start', cc.sms_quiet_start,
             'sms_quiet_end', cc.sms_quiet_end,
             'first_touch_quiet_exempt', cc.first_touch_quiet_exempt,
             'ai_daily_contact_cap', cc.ai_daily_contact_cap) AS config
      FROM (VALUES (1)) AS one(x)
      LEFT JOIN tenant_comms_config cc
             ON cc.organization_id = p_org AND cc.store_id IS NULL AND cc.deleted_at IS NULL
  ),
  branding AS (
    -- 'draft' on this row means "has unpublished edits", not "nothing is live";
    -- 'none' means no brand row exists at all.
    SELECT COALESCE(b.status, 'none') AS state, b.version, b.published_at
      FROM (VALUES (1)) AS one(x)
      LEFT JOIN tenant_branding b
             ON b.organization_id = p_org AND b.store_id IS NULL AND b.deleted_at IS NULL
  )
  SELECT
    (SELECT count(DISTINCT mb.user_id)::integer FROM memberships mb
      WHERE mb.organization_id = p_org AND mb.status = 'active'),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'id', s.id,
                       'name', s.name,
                       'code', s.code,
                       'status', s.status,
                       'timezone', s.timezone,
                       -- The dealer's OWN number, not a boolean: it is what a
                       -- support person checks against the Twilio console.
                       'sms_number', s.sms_number,
                       -- Reads false for effectively every store today — the
                       -- console cannot set business hours yet — so both
                       -- captions say "not settable from the console", not
                       -- "misconfigured".
                       'business_hours_set', s.business_hours <> '{}'::jsonb,
                       'traffic_30d', jsonb_build_object(
                          'inbound',   COALESCE(t.inbound, 0),
                          'outbound',  COALESCE(t.outbound, 0),
                          'delivered', COALESCE(t.delivered, 0),
                          'last_message_at', t.last_message_at))
                     ORDER BY s.code)
                FROM stores s
                LEFT JOIN traffic t ON t.store_id = s.id
               WHERE s.organization_id = p_org AND s.deleted_at IS NULL), '[]'::jsonb),
    -- NEVER token, NEVER secret. `last_lead_accepted_at` is the honest name for
    -- intake_keys.last_used_at: f03-intake-routes.ts:542 stamps it INSIDE the
    -- accepted-lead transaction, so a bad signature, a suspended-tenant 410 or
    -- a dedupe rejection all leave it untouched — "last seen" would be false.
    -- `revoked_at` rides beside `active` because the two are independent
    -- (0005:26 and :30) and a revoked key with active = true would otherwise
    -- render as a live endpoint.
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'id', k.id,
                       'store_id', k.store_id,
                       'label', k.label,
                       'provider', k.provider,
                       'active', k.active,
                       'revoked_at', k.revoked_at,
                       'last_lead_accepted_at', k.last_used_at)
                     ORDER BY k.label)
                FROM intake_keys k WHERE k.organization_id = p_org), '[]'::jsonb),
    comms.config,
    branding.state,
    branding.version,
    branding.published_at,
    (SELECT count(*)::integer FROM tenant_connectors tc
      WHERE tc.organization_id = p_org AND tc.is_active)
  FROM comms, branding;
END $$;
REVOKE ALL ON FUNCTION admin_tenant_snapshot(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_tenant_snapshot(uuid, uuid) TO dealpilot_app;

COMMENT ON FUNCTION admin_tenant_snapshot(uuid, uuid) IS
  'The §9 tenant snapshot: only what admin_get_tenant does not already return. Intake credentials (token, secret) are excluded BY NAME and a mutation test proves it. Any platform role may read it (tenants:read).';

-- ---------------------------------------------------------------------------
-- 4. admin_record_queue_retry (§9, §12) — the register, written FIRST
-- ---------------------------------------------------------------------------
--
-- The route calls this BEFORE it touches Redis, and the event is named for
-- what can honestly be recorded at that moment. Redis and Postgres cannot
-- commit together: auditing afterwards leaves a window in which jobs are
-- requeued and the register write fails, which is an unaudited act, and §9's
-- "actions audited" forbids exactly that. Over-recording is the fail-closed
-- direction D-073 already chose for the kill switches.
--
-- So there is no p_retried, and no outcome coherence check: at call time no
-- outcome is known. What the row carries is the request — the queue, the ids
-- asked for, the DISTINCT organizations those ids name, and the reason.
-- p_organization_ids is what lets the register answer "whose customer got the
-- second SMS", which is the hazard the typed-back confirm and the 20-id cap
-- exist for; the inspector has already parsed each payload to project
-- organization_id for the DLQ filter, so it costs one array parameter.
--
-- target_user_id stays NULL and the subject lives in `changes` — the 0065/0067/0068
-- convention.
CREATE FUNCTION admin_record_queue_retry(p_actor uuid, p_queue text,
                                         p_requested text[], p_organization_ids uuid[],
                                         p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support']);
  IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason required' USING ERRCODE = '23514';
  END IF;
  -- Shape, not vocabulary (see the header): the catalogue lives in TypeScript.
  IF p_queue !~ '^[a-z][a-z0-9-]{2,40}$' THEN
    RAISE EXCEPTION 'queue name is not queue-shaped: %', p_queue USING ERRCODE = 'PA014';
  END IF;
  IF COALESCE(array_length(p_requested, 1), 0) = 0 THEN
    RAISE EXCEPTION 'retry payload names no job' USING ERRCODE = 'PA014';
  END IF;
  INSERT INTO platform_audit_events (actor_user_id, actor_type, event, changes, reason)
  VALUES (p_actor, 'platform', 'queue.retry_requested',
          jsonb_build_object('queue', p_queue,
                             'requested', to_jsonb(p_requested),
                             'organizations', to_jsonb(COALESCE(p_organization_ids, ARRAY[]::uuid[]))),
          btrim(p_reason));
END $$;
REVOKE ALL ON FUNCTION admin_record_queue_retry(uuid, text, text[], uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_record_queue_retry(uuid, text, text[], uuid[], text) TO dealpilot_app;

COMMENT ON FUNCTION admin_record_queue_retry(uuid, text, text[], uuid[], text) IS
  'Files the §12 register row for a DLQ retry BEFORE any job is touched (admin-console.md §9). The event is queue.retry_requested, not jobs_retried: at call time no outcome is known.';

-- ---------------------------------------------------------------------------
-- 5. platform_audit_events — one new event (§12)
-- ---------------------------------------------------------------------------
-- Restated whole in 0068's shape. Exactly one value is added: F-73 has one
-- mutation, and its producer is §4 above — so platform-event-vocabulary.test.ts
-- is satisfied by SQL evidence rather than by declaration.
--
-- The three READ routes write no audit event. §12 audits mutations, and every
-- admin request already writes the `platform_access` log line; an audit value
-- nothing distinguishes is dead vocabulary.
ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_event_check;
ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_event_check
  CHECK (event IN ('staff.granted','staff.role_changed','staff.reinstated','staff.revoked',
                   'announcement.published','announcement.ended','settings.flipped',
                   'queue.retry_requested'));
