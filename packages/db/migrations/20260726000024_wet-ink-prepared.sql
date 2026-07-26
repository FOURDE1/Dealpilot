-- 0024 — the wet-ink question dispatch actually needs (documents.md §6).
--
-- 0023 gated dispatch on every signature document being `signed`. But §4 defines
-- `signed` as "client signed the physical copy AT DELIVERY" — so that gate
-- demanded an outcome that can only exist AFTER the delivery it was supposed to
-- authorize. Satisfying it honestly was impossible; the only ways through were
-- to mark documents signed before anyone signed them, or to waive the checklist
-- item. A gate that pushes staff to lie is worse than no gate.
--
-- §6 gives the real rule: the file is PREPARED when every signature document is
-- at `printed` or later — printed, assembled, ready to travel. That is what a
-- driver needs. Completion is a different, later question, kept separate.

/**
 * Is the wet-ink file ready to travel? Every document that needs a signature is
 * printed or further along; information-only documents need only be in the file.
 *
 * NULL means the deal has no document list at all — it predates F-13, so there
 * is nothing to assert either way, and it must not become undeliverable.
 */
CREATE FUNCTION wet_ink_prepared(p_deal uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN count(*) = 0 THEN NULL
    ELSE bool_and(
      CASE WHEN requires_signature
           -- printed or later: the paper physically exists and is in the folder.
           THEN status IN ('e_signed','printed','in_file','signed','filed')
           ELSE status IN ('generated','in_file','filed')
      END)
  END
  FROM deal_documents
  WHERE deal_id = p_deal AND deleted_at IS NULL;
$$;

-- §4 and its diagram: only an information-only document may go straight from
-- `in_file` to `filed`. A signature document that skipped `signed` would count
-- as complete with signed_at_delivery NULL — the record would say a customer
-- signed something nobody watched them sign.
CREATE OR REPLACE FUNCTION wet_ink_complete(p_deal uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN count(*) = 0 THEN NULL
    ELSE bool_and(
      CASE WHEN requires_signature
           -- `filed` is only reachable through `signed` for these (enforced in
           -- the route's transition table), so both are accepted here.
           THEN status IN ('signed','filed') AND signed_at_delivery IS NOT NULL
           ELSE status IN ('in_file','filed')
      END)
  END
  FROM deal_documents
  WHERE deal_id = p_deal AND deleted_at IS NULL;
$$;

-- Needed so the as-is waiver rule can ever fire: 0023 added the column and
-- nothing could set it, which made that branch dead code.
--
-- NOT doing the other half. documents.md §3 and delivery.md §2.2 say an as-is
-- sale EXEMPTS the safety inspection. The owner's instruction on D-033 was that
-- the safety inspection is a legal obligation nobody may waive. Those two cannot
-- both hold, and choosing between them is his call, not mine — filed in
-- docs/OWNER-DECISIONS-PENDING.md as D-036. 0023's comment claimed the coupling
-- existed; it never did, and that claim is corrected there.
COMMENT ON COLUMN deals.sold_as_is IS
  'Sold as-is. Adds the as-is waiver to the document file. Does NOT currently exempt the safety inspection — see D-036.';
