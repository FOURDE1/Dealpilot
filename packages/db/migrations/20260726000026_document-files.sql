-- 0026 — the stored file behind a document, and its hash (F-13c).
--
-- F-13 made the file's PREPARATION verifiable: every paper printed and in the
-- folder, checked by the database rather than ticked by a person. It did not
-- make the FILE verifiable. `status = 'signed'` is still someone asserting that
-- a signature exists somewhere off-system — a graded assertion, but an
-- assertion. `unsigned_file_url` and `signed_file_url` are free text pointing
-- at whatever a clerk pasted, with nothing behind them.
--
-- These columns are the other half. A stored document carries the SHA-256 of
-- its bytes, and every read recomputes it, so "this is the contract the
-- customer signed" becomes something the system can check instead of repeat.

ALTER TABLE deal_documents
  -- Server-built, per-tenant prefixed (ADR-013): org/<org>/deals/<deal>/...
  ADD COLUMN storage_key    text,
  -- Hex SHA-256 of the stored bytes. 64 chars, lowercase, always.
  ADD COLUMN content_sha256 text
    CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN content_type   text
    CHECK (content_type IS NULL OR content_type IN ('application/pdf','image/jpeg','image/png')),
  ADD COLUMN size_bytes     integer CHECK (size_bytes IS NULL OR size_bytes > 0),
  ADD COLUMN uploaded_at    timestamptz,
  ADD COLUMN uploaded_by    uuid REFERENCES users(id) ON DELETE SET NULL,

  -- Either a document has a stored file with all of its metadata, or it has
  -- none of it. A key with no hash is a file nobody can verify, which is the
  -- state this migration exists to remove.
  ADD CONSTRAINT deal_documents_file_complete CHECK (
    (storage_key IS NULL AND content_sha256 IS NULL AND content_type IS NULL
      AND size_bytes IS NULL AND uploaded_at IS NULL)
    OR
    (storage_key IS NOT NULL AND content_sha256 IS NOT NULL AND content_type IS NOT NULL
      AND size_bytes IS NOT NULL AND uploaded_at IS NOT NULL)
  );

/**
 * Is this deal's file VERIFIED — not merely claimed?
 *
 * True when every document that needs a signature has a stored file whose hash
 * is on record. Information-only documents are not required to be scanned;
 * nobody signs a Carfax and demanding an image of one would block deliveries
 * for no gain.
 *
 * Nothing GATES on this yet, deliberately. Requiring a scan before a deal can
 * be filed is a workflow change for every store — some scan at the desk, some
 * batch it at month-end — and that is the owner's call, filed as D-039. It is
 * reported so the difference between "someone said it is signed" and "the
 * signed page is here and unaltered" is visible in the meantime.
 */
CREATE FUNCTION wet_ink_verified(p_deal uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN count(*) FILTER (WHERE requires_signature) = 0 THEN NULL
    ELSE bool_and(content_sha256 IS NOT NULL) FILTER (WHERE requires_signature)
  END
  FROM deal_documents
  WHERE deal_id = p_deal AND deleted_at IS NULL;
$$;

COMMENT ON COLUMN deal_documents.content_sha256 IS
  'SHA-256 of the stored bytes, recomputed on every read — a filed document is verifiable rather than asserted (F-13c).';
