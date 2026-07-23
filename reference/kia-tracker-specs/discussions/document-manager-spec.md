# Document Manager — Final Specification

## Overview

Tracks every document in a deal file from creation through signing, delivery, and filing. All documents go wet ink at delivery. E-signing (OneSpan or DocuSign, varies by store) is used for initial remote signing, then physical copies are re-signed at delivery. Signed documents are uploaded and stored in the system for instant retrieval.

---

## E-Signature Platform

| Store | Platform |
|---|---|
| Configurable per store | OneSpan OR DocuSign |

Stored in `stores.esign_platform` — no API integration for now. The system tracks envelope/package IDs for reference, and signed documents are uploaded back into the system.

---

## Document Catalog (Standard Deal File)

### Documents per deal

| # | Document | Source | Conditional | E-Sign | Wet Ink |
|---|---|---|---|---|---|
| 1 | **Bank contract** | DealerTrack | All financed deals | ✅ | ✅ |
| 2 | **Bill of sale** | CAMS (Ready Group) / Merlin (Kia) | All deals | ✅ | ✅ |
| 3 | **Warranty agreement** | F&I product sale | Only if warranty sold | ✅ | ✅ |
| 4 | **GAP agreement** | F&I product sale | Only if GAP sold | ✅ | ✅ |
| 5 | **Aftermarket product agreements** | F&I product sale | Only if products sold | ✅ | ✅ |
| 6 | **Privacy/consent disclosure** | Internal form | All deals | ✅ | ✅ |
| 7 | **OMVIC disclosure** | Regulatory | Ontario deals only | ✅ | ✅ |
| 8 | **Vehicle condition disclosure** | Internal form | All deals | ✅ | ✅ |
| 9 | **Trade-in lien payoff authorization** | Internal form | Only if trade-in has a lien | ✅ | ✅ |
| 10 | **Odometer statement** | Internal form | All deals | ✅ | ✅ |
| 11 | **As-is waiver** | Internal form | Only if sold as-is | ✅ | ✅ |
| 12 | **Carfax report** | Carfax | All used vehicle deals | N/A (not signed) | Included in file |
| 13 | **Lease agreement** | DealerTrack / lender | Lease deals only (Kia/franchise) | ✅ | ✅ |

### Auto-generation logic
When a deal reaches the "Signed" pipeline stage, the system auto-generates the document checklist based on:
- **All deals get:** Bill of sale, privacy/consent, vehicle condition, odometer statement
- **Financed deals add:** Bank contract
- **Ontario deals add:** OMVIC disclosure
- **Deals with F&I products add:** One agreement per product sold (warranty, GAP, etc.)
- **Trade-in with lien adds:** Trade-in lien payoff authorization
- **Sold as-is adds:** As-is waiver
- **Used vehicles add:** Carfax report
- **Lease deals add:** Lease agreement (Kia/franchise stores only)

---

## Document Lifecycle

```
Not Ready → Generated → E-Signed → Printed → In Wet Ink File → Signed at Delivery → Filed
```

### Status definitions

| Status | Meaning |
|---|---|
| **not_ready** | Document hasn't been created yet |
| **generated** | Document created in source system (CAMS, Merlin, DealerTrack) or internally |
| **e_signed** | Client signed via OneSpan/DocuSign (for applicable docs) |
| **printed** | Physical copy printed for wet ink file |
| **in_file** | Included in the wet ink file given to driver |
| **signed** | Client signed the physical copy at delivery |
| **filed** | Signed document uploaded to system, deal file complete |

### Non-signed documents (e.g., Carfax)
- Follow a simpler flow: not_ready → generated → in_file → filed
- No signing step needed

---

## Signed Document Storage

### Upload and instant retrieval
When signed documents return from delivery:
- Admin or F&I uploads each signed document (scan or photo)
- Each document is tagged with its type and linked to the deal
- Documents are stored in Supabase Storage
- Any authorized user can pull up any document instantly from the deal record
- Search by: deal number, client name, stock number, VIN, document type

### Future phase: auto-upload
- Integration with scanner/email to auto-ingest scanned documents
- OCR to auto-detect document type and match to deal
- For now: manual upload per document

---

## Wet Ink File Workflow

### Who prepares
F&I agent or admin/office staff depending on the store.

### Preparation process
1. All documents that need wet ink signing are printed
2. Documents assembled in order in a folder/envelope
3. Person preparing marks each document as "printed" in the system
4. When all documents are printed → wet ink file status changes to "prepared"
5. File given to driver → status changes to "with_driver" (tracked in delivery checklist)
6. After delivery: signed documents return → each uploaded and marked "filed"

### Wet ink file contents checklist
The system shows a printable checklist of all documents that need to be in the file:
```
WET INK FILE — Deal A12345 — John Smith — 2022 Kia Forte
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ☐ Bank contract (TD Auto Finance)
  ☐ Bill of sale
  ☐ Extended warranty agreement
  ☐ GAP agreement
  ☐ Privacy/consent disclosure
  ☐ OMVIC disclosure
  ☐ Vehicle condition disclosure
  ☐ Odometer statement
  ☐ Carfax report

  Prepared by: _______________  Date: _______________
```

---

## Database

### New table: `deal_documents`

```sql
CREATE TABLE deal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) NOT NULL,

  -- Document identification
  document_type TEXT NOT NULL,
  -- 'bank_contract', 'bill_of_sale', 'warranty_agreement', 'gap_agreement',
  -- 'aftermarket_agreement', 'privacy_consent', 'omvic_disclosure',
  -- 'vehicle_condition', 'trade_in_lien_authorization', 'odometer_statement',
  -- 'as_is_waiver', 'carfax_report'
  document_name TEXT NOT NULL, -- display name (e.g., "GAP Agreement — Safe-Guard")
  source_system TEXT, -- 'dealertrack', 'cams', 'merlin', 'internal', 'carfax'

  -- Status
  status TEXT DEFAULT 'not_ready',
  -- 'not_ready', 'generated', 'e_signed', 'printed', 'in_file', 'signed', 'filed'
  requires_signature BOOLEAN DEFAULT true, -- false for Carfax, info-only docs

  -- E-signature tracking
  esign_platform TEXT, -- 'onespan', 'docusign'
  esign_envelope_id TEXT, -- envelope/package ID for reference
  esign_sent_at TIMESTAMPTZ,
  esign_signed_at TIMESTAMPTZ,

  -- Physical document tracking
  printed_at TIMESTAMPTZ,
  printed_by UUID REFERENCES users(id),
  signed_at_delivery TIMESTAMPTZ,

  -- Filed document (uploaded signed copy)
  unsigned_file_url TEXT, -- original unsigned document
  signed_file_url TEXT, -- uploaded signed copy
  filed_at TIMESTAMPTZ,
  filed_by UUID REFERENCES users(id),

  -- Meta
  notes TEXT,
  sort_order INTEGER DEFAULT 0, -- display order in checklist
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_docs_deal ON deal_documents(deal_id);
CREATE INDEX idx_docs_status ON deal_documents(status);
```

### Modify `stores` table

```sql
ALTER TABLE stores ADD COLUMN esign_platform TEXT; -- 'onespan', 'docusign'
```

---

## API Endpoints

```
# Documents
GET    /api/deals/:id/documents                — All documents for a deal
POST   /api/deals/:id/documents                — Add a document manually
PUT    /api/documents/:id                       — Update document status/details
DELETE /api/documents/:id                       — Remove a document
POST   /api/deals/:id/documents/generate        — Auto-generate document checklist based on deal type
GET    /api/deals/:id/documents/completion       — Returns: { total, completed, percentage, missing[] }

# Document files
POST   /api/documents/:id/upload-unsigned       — Upload original unsigned document
POST   /api/documents/:id/upload-signed          — Upload signed copy (from delivery return)

# Wet ink file
GET    /api/deals/:id/documents/wet-ink-checklist — Printable checklist of all docs for wet ink file
POST   /api/deals/:id/documents/mark-printed      — Mark multiple docs as printed (batch)
POST   /api/deals/:id/documents/mark-filed         — Mark multiple docs as filed with uploads (batch)

# Search
GET    /api/documents/search                     — Search across all deals: by client name, stock #, VIN, document type
```

---

## UI Specification

### Document Section (within Deal Detail)

```
Documents                           [8 of 10 filed]   [Generate Checklist]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[=============================-----] 80%

  🟢 Bank contract              Filed     [View Signed] [View Original]
  🟢 Bill of sale (CAMS)        Filed     [View Signed] [View Original]
  🟢 Warranty agreement         Filed     [View Signed]
  🟢 GAP agreement              Filed     [View Signed]
  🟢 Privacy/consent            Filed     [View Signed]
  🟢 OMVIC disclosure           Filed     [View Signed]
  🟢 Vehicle condition          Filed     [View Signed]
  🟢 Odometer statement         Filed     [View Signed]
  🟡 Trade-in lien auth         Signed    [Upload Signed Copy]
  🟡 Carfax report              In File   [Upload Filed Copy]

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Wet Ink File: ✅ Prepared by Sarah, Apr 10
  [Print Checklist]  [Mark All Printed]  [Bulk Upload Signed]
```

### Bulk Upload (after delivery)
```
Upload Signed Documents
━━━━━━━━━━━━━━━━━━━━━━━

  [Drag & drop files here or click to browse]

  Uploaded files:
    scan_001.pdf  →  [Bank Contract ▾]       ✅ Matched
    scan_002.pdf  →  [Bill of Sale ▾]        ✅ Matched
    scan_003.pdf  →  [Select document... ▾]  ⚠️ Unmatched

  [Save All]
```

### Document Search (admin feature)
```
Search Documents                    [Search by client, stock #, VIN, type]

  Results for "John Smith":
    Deal A12345 — John Smith — 2022 Kia Forte
      📄 Bank contract (filed)    [View]
      📄 Bill of sale (filed)     [View]
      📄 Warranty (filed)         [View]
      ...
```

---

## Connections to Other Modules

| Connection | How it works |
|---|---|
| **Deal Pipeline** | When deal reaches "Signed" stage → auto-generate document checklist |
| **Pre-Delivery Checklist** | wet_ink_status reads from document completion (all docs printed = prepared) |
| **Delivery Tracker** | Wet ink file given to driver tracked here |
| **F&I Products** | When F&I products added to deal → corresponding agreement docs auto-added to checklist |
| **Inventory** | Bill of sale source system determined by store (CAMS vs Merlin) |

---

## Prompt to Build This

```
Build the Document Manager module for the Kia Deal Tracker.

DATABASE:
1. Create deal_documents table: [paste SQL above]
2. Add esign_platform column to stores table

BACKEND:

1. Create server/routes/documents.js:
   - CRUD for deal documents
   - POST /api/deals/:id/documents/generate:
     - Auto-generates document checklist based on deal type:
       - All deals: bill_of_sale, privacy_consent, vehicle_condition, odometer_statement
       - Financed: + bank_contract
       - Ontario: + omvic_disclosure
       - Has F&I products: + one agreement per product type from deal_fi_products
       - Trade-in with lien: + trade_in_lien_authorization
       - Sold as-is: + as_is_waiver
       - Used vehicle: + carfax_report
     - Sets source_system based on store (bill_of_sale → 'cams' for Ready Group, 'merlin' for Kia)
     - Sets requires_signature = false for carfax_report
   - GET /api/deals/:id/documents/completion: returns total, completed, percentage, missing docs
   - POST /upload-unsigned and /upload-signed: file upload to Supabase Storage
   - POST /mark-printed: batch update multiple docs to "printed" status
   - POST /mark-filed: batch update with signed file uploads
   - GET /api/deals/:id/documents/wet-ink-checklist: returns printable checklist
   - GET /api/documents/search: search across deals by client name, stock #, VIN, document type

2. Auto-generate trigger:
   - When deal pipeline_stage changes to "signed", auto-call the generate endpoint if no documents exist yet
   - When F&I products are added/removed from a deal, add/remove corresponding agreement documents

3. Connection to pre-delivery checklist:
   - When all documents with requires_signature = true are at status "printed" or later → update deal's wet_ink_status to "prepared"

FRONTEND:

1. Create DocumentSection.jsx — tab within DealDetail:
   - Document list with status badges (color coded by status)
   - Per-document actions: View Original, View Signed, Upload Signed Copy
   - Progress bar: "X of Y filed"
   - "Generate Checklist" button (if no docs exist yet)
   - "Print Checklist" button (opens printable wet ink checklist)
   - "Mark All Printed" batch action
   - "Bulk Upload Signed" — drag-and-drop multiple files, match each to a document type

2. Create DocumentUpload.jsx:
   - Drag-and-drop zone
   - File-to-document-type matching dropdown
   - Batch save

3. Create DocumentSearch.jsx (admin page):
   - Search bar: client name, stock #, VIN, document type
   - Results grouped by deal
   - Click to view/download any document

4. Integrate DocumentSection into DealDetail.jsx as "Documents" tab
5. Add document search to admin/settings area

Add EN/FR translations for all new strings.
```
