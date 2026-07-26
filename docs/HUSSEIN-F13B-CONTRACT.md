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

## Next from me

**F-13c** — document storage: upload of the signed file, a content hash so a
filed document is verifiable rather than asserted, and the printable wet-ink
sheet. Storage sits behind a driver: local filesystem in dev, S3 in deployed
environments. **No S3 bucket will be created** — the owner's standing
instruction is that no paid AWS resource is provisioned during the build, so the
S3 driver ships configured and unexercised, with the local driver as the default.
You will get an upload endpoint that works end-to-end against the local driver.
