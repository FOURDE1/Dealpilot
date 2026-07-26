# F-13b — itemised F&I: what the API gives you

Merged to `develop` (707e7c2), CI green, 463/463. Nothing you already built
breaks — this is additive.

## Why it exists

Three document types you are already rendering — `warranty_agreement`,
`gap_agreement`, `aftermarket_agreement` — could never appear in a deal's file.
F&I was one unnamed number on the deal, so there was nothing to name an
agreement after. Your panel was correct and the data behind it was empty.

Now a warranty sold is a warranty agreement in the file, named after the
product, with no extra step.

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/v1/deals/:id/fi-products` | — | `DealFiProduct[]`, in `sort_order` |
| POST | `/api/v1/deals/:id/fi-products` | `CreateFiProductInput` | 201 `DealFiProduct` |
| PATCH | `/api/v1/fi-products/:id` | `UpdateFiProductInput` | 200 `DealFiProduct` |
| DELETE | `/api/v1/fi-products/:id` | — | 204 |

Schemas are exported from `@dealpilot/schemas` (`DealFiProduct`,
`CreateFiProductInput`, `UpdateFiProductInput`, `FiProductKind`). All four are
in `apiV1.fiProducts` — the contract-coverage guard checks both directions, so
if it type-checks, it exists.

## What the UI needs to know

**Permission is `deal:update`** — the same authority that edits the deal, not a
new one. If they can edit the worksheet, they can sell F&I.

**One warranty, one GAP, many aftermarket.** A second warranty is a **409**
`product_exists`, not a validation error. Mirrors the document file exactly: a
second warranty agreement would be swallowed by the unique index and leave a
product with no paperwork. Show it as "this deal already has a warranty" and
offer to edit the existing one.

**Cost may not exceed price** — 422 `cost_above_price`, enforced on create AND
on PATCH. Dropping the price under an untouched cost is the same loss by another
route. Field is `cost_cents`.

**The deal's F&I total is now derived.** `deals.fi_price_cents` and
`fi_cost_cents` are the maintained sum of the products, updated in the same
transaction by a database trigger. Two consequences for the worksheet:

1. After any product write, **re-read the deal** — its F&I numbers and every
   derived total (taxes, amount financed, payment, gross) will have moved.
2. Adding the first product to a deal with a hand-entered F&I number
   **replaces** that number. It is recorded in the activity trail with
   `fi_price_cents: {from, to}`, so it is auditable — but the user will see
   their typed value change. Worth a one-line confirmation before the first
   product on a deal whose `fi_price_cents` is non-zero.

**The F&I box on the worksheet should become read-only once products exist**,
with an "itemise" affordance. Editing both is two sources of truth and the
trigger will win.

**Documents update themselves.** Adding, renaming or removing a product
regenerates the deal's file in the same transaction — so after a product write,
refetch `/deals/:id/documents` too. A renamed product renames its agreement
*while that agreement is untouched*; once printed or signed it is part of the
record and keeps the name it was printed with. Deleting a product removes its
unprinted agreement and leaves a printed one alone.

**Two aftermarket products get two agreements** distinguished only by
`document_name`. Do not key your list rendering on `document_type` alone.

## Not built, on purpose

No per-product `taxable` switch. Desking derives the tax base from the deal's
aggregate, so a non-taxable product would be taxed anyway — a control that
changes nothing and overcharges tax while reporting success. Filed as **D-037**
for the owner (does the group sell credit life / disability insurance?). If he
says yes, the tax base starts reading products and the switch becomes real — I
will send you a contract note before that lands.

---

# F-13c — document files (also merged: ec57bc8, CI green, 475/475)

Correcting what I told you above: the S3 driver did **not** ship. I said it would
ship "configured and unexercised" — a driver nobody can run against the real
service is a driver nobody has tested, so I left the interface and wrote only
the local one. Do not plan around an S3 path existing yet. What did ship works
end-to-end.

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/api/v1/documents/:id/file` | **raw bytes** | 201 `DealDocument` |
| GET | `/api/v1/documents/:id/file` | — | 200 the bytes |
| POST | `/api/v1/deals/:id/documents/batch` | `BatchDocumentInput` | 200 `{items}` |

**The upload is raw bytes, not multipart and not JSON.** Send the File/Blob as
the body with a real `Content-Type`: `application/pdf`, `image/jpeg` or
`image/png`. Anything else is **415**. Empty body is **422**. Max 20 MB.

```ts
await fetch(`/api/v1/documents/${id}/file`, {
  method: 'POST', credentials: 'include',
  headers: { 'content-type': file.type }, body: file,
});
```

`DealDocument` gained `storage_key`, `content_sha256`, `content_type`,
`size_bytes`, `uploaded_at`, `uploaded_by` — all null together or all set
together, enforced by the database.

## The one behaviour worth designing around

**A download can fail with 409 `content_mismatch`.** That means the stored bytes
no longer hash to what was recorded at upload — the file is not the one anyone
signed, so the API refuses to serve it rather than hand back an altered page.
This is not a transient error and retrying will not fix it. Surface it as
something serious: "this file has changed since it was filed", not a toast.

A document with no file at all is a plain **404** — that is the normal
not-uploaded-yet case, and it is what you branch on to show the upload control.

## Batch marking

`{ document_ids: string[], status }`, max 50, all in one transaction. If any one
document cannot make that transition the **whole call is 422** and nothing
moves — a half-marked file is exactly what the dispatch gate would then read as
ready. An id belonging to another deal is a 404, not a silent skip. Permission
is graded the same as the single PATCH: `document:sign` for
signed/e_signed/filed, `document:prepare` otherwise.

Good fit for the printable sheet you already built: print the stack, then mark
the stack.

## `wet_ink_verified`

New field on the documents response, alongside `wet_ink_prepared` and
`wet_ink_complete`. True when every signature document has a stored page whose
hash is on record; null when the deal has no signature documents.

**Nothing gates on it** — requiring a scan before filing is a workflow change
for every store, so it is the owner's call (D-039). Show it as information: a
"pages on file" state distinct from "someone ticked signed".

## Next from me

**F-11c** — customer delivery notification and the driver status feed.

---

# Store settings — three fields that need a form (merged: bf0a90f)

A dead-column guard found that `stores.bill_of_sale_system` has been **read** by
the document generator since F-13 and settable by nobody. Every store sits on
the CAMS default, so a Kia store that prints its bill of sale from Merlin cannot
be configured — the feature shipped unreachable. Same for the dispatch conflict
window.

All three are now on `CreateStoreInput` and `UpdateStoreInput`, **optional**, so
your existing store form keeps compiling untouched:

| Field | Values | What it does |
| --- | --- | --- |
| `bill_of_sale_system` | `CAMS` \| `Merlin` \| `Other` | Which system prints this store's bill of sale. Changes the `source_system` on the bill-of-sale document in every deal's file |
| `esign_platform` | `onespan` \| `docusign` \| null | The store's e-sign provider |
| `dispatch_conflict_window_hours` | 1–24, default 4 | How close two deliveries must be before the dispatch board flags them as a conflict |

They also appear on the `Store` read model.

**What I'd suggest:** a "Store settings" section on the store form — not the
create flow. A store is opened first and configured after, which is why these
are optional rather than defaulted. `bill_of_sale_system` is the one that
matters day to day; the other two are set once and forgotten.

No rush and nothing breaks without it — the defaults are sane. But until there
is a form, a multi-brand group cannot set up its Merlin stores.
