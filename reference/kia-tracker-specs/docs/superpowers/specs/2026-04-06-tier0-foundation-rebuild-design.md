# Tier 0 Foundation Rebuild — Design Specification

**Date:** 2026-04-06
**Approach:** B — Clean Foundation, Migrate Features
**Breaking changes:** Allowed (no production users)
**Goal:** Enterprise-grade foundation that can compete with Salesforce, GoHighLevel, DealerSocket, Reynolds ERA

---

## 1. Contacts Table — Independent Customer Records (Task 1)

The system currently embeds customer data inside the deals table. There is no independent contact record. A repeat customer creates duplicate data. This is the single most important structural change.

### 1.1 Schema

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id),

  -- Identity
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  phone_secondary TEXT,
  preferred_language TEXT DEFAULT 'fr', -- 'en', 'fr' (French-first for Bill 96)
  preferred_contact TEXT DEFAULT 'text', -- 'text', 'call', 'email'

  -- Address
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,

  -- Profile
  date_of_birth DATE,
  drivers_license_number TEXT,
  employer TEXT,
  occupation TEXT,
  annual_income TEXT, -- stored as text range: '30k-50k', '50k-75k', etc.

  -- Relationship tracking
  source TEXT, -- 'lead', 'walk_in', 'referral', 'existing_customer', 'website'
  referred_by_contact_id UUID REFERENCES contacts(id),
  customer_since DATE DEFAULT CURRENT_DATE,
  lifetime_deals INTEGER DEFAULT 0,
  lifetime_value NUMERIC DEFAULT 0,

  -- Status
  status TEXT DEFAULT 'active', -- 'active', 'inactive', 'do_not_contact'
  tags TEXT[] DEFAULT '{}',
  notes TEXT,

  -- Consent (PIPEDA compliance)
  consent_marketing BOOLEAN NOT NULL DEFAULT false,
  consent_marketing_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  deleted_at TIMESTAMPTZ, -- soft delete
  version INTEGER NOT NULL DEFAULT 1 -- optimistic locking
);

CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_name ON contacts(last_name, first_name);
CREATE INDEX idx_contacts_store ON contacts(store_id);
CREATE INDEX idx_contacts_not_deleted ON contacts(id) WHERE deleted_at IS NULL;

-- Full-text search vector
ALTER TABLE contacts ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(first_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(last_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(email, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(phone, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(city, '')), 'C')
  ) STORED;

CREATE INDEX idx_contacts_search ON contacts USING gin(search_vector);
```

### 1.2 Link to Existing Tables

```sql
ALTER TABLE deals ADD COLUMN contact_id UUID REFERENCES contacts(id);
```

The `deal_parties` join table supports buyer + cosigner roles:

```sql
CREATE TABLE deal_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id),
  role TEXT NOT NULL CHECK (role IN ('buyer', 'cosigner')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(deal_id, contact_id, role)
);
```

`contact_id` on deals is a denormalized shortcut for the primary buyer. `deal_parties` is the authoritative source.

### 1.3 Auto-Link Logic

On every new deal creation:
1. Check if `contact_id` is provided → use it
2. If not, check if a contact with matching phone exists → link it
3. If not found, auto-create a contact from the deal's customer fields and link it

Same logic for future lead creation.

### 1.4 Backend — server/routes/contacts.js

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/contacts | List with filters (name, phone, email, store, status, tags), pagination, store scoping |
| GET | /api/v1/contacts/:id | Single contact with associated deals, leads, and activity count |
| POST | /api/v1/contacts | Create (auto-check for duplicates on phone + email before creating) |
| PUT | /api/v1/contacts/:id | Update (set updated_at, version check) |
| DELETE | /api/v1/contacts/:id | Soft delete (set deleted_at, don't CASCADE) |
| GET | /api/v1/contacts/:id/deals | All deals for this contact |
| GET | /api/v1/contacts/:id/activity | Activity timeline (from activity_events — Task 2) |
| GET | /api/v1/contacts/:id/communications | All SMS/email/chatbot messages (future) |
| POST | /api/v1/contacts/merge | Merge two contacts: `{ keep_id, merge_id }`. Move all deals, leads, activity from merge_id to keep_id. Soft delete merge_id. Merge notes. Keep older customer_since. |
| POST | /api/v1/contacts/find-duplicates | Check phone/email against existing contacts, return matches |

### 1.5 Frontend — client/src/components/contacts/

**ContactsDashboard.jsx** — Stats bar (total contacts, new this month, repeat customers, avg lifetime value) + filter bar (search, status, tags, source, date range) + contact list. Follow Dashboard.jsx pattern.

**ContactCard.jsx** — Name (bold), phone, email, location (city/province), deals count badge, last activity date, status pill. Follow DealCard pattern.

**ContactDetail.jsx** — THREE-COLUMN LAYOUT (HubSpot/Salesforce industry standard):
- **Left column (280px):** Key properties (name, phone, email, address, preferred language, customer since, lifetime deals, lifetime value, tags, notes). Each field is inline-editable on click.
- **Center column (flex):** Activity timeline (from activity_events — Task 2). Chronological feed with filter tabs: All, Calls, Emails, SMS, Notes, Stage Changes. Each entry: icon + type label + timestamp + preview. "Add Note" quick action pinned at top.
- **Right column (300px):** Associated records — Deals (list with stage pill + amount), Vehicles owned (from deals where contact was buyer). Each card clickable to navigate.

**ContactForm.jsx** — Create/edit form with all fields. Phone auto-format. Postal code validates Canadian format (A1A 1A1).

**MergeContactsDialog.jsx** — Modal showing two contacts side by side. User picks which value to keep per field. Confirm calls merge endpoint.

**Routing and Navigation:**
- Add route `/contacts` → ContactsDashboard
- Add route `/contacts/:id` → ContactDetail
- Add "Contacts" to sidebar ABOVE "Dashboard" (top-level entity). Use Users icon from lucide-react.
- Add EN/FR translations for all new strings.

### 1.6 Deals Table Migration

Remove these columns (data migrated to contacts table):
- `customer_name` → `contacts.first_name` + `contacts.last_name`
- `customer_address` → `contacts.address_line1` + `contacts.city` + `contacts.province` + `contacts.postal_code`
- `customer_phone` → `contacts.phone`
- `has_cosigner` → derived from deal_parties count
- `cosigner_name` → deal_parties with role='cosigner'

Add to deals:
- `contact_id UUID REFERENCES contacts(id)` — primary buyer shortcut
- `pipeline_stage TEXT NOT NULL DEFAULT 'new'` — 10 stages: new, submitted, approved, signed, sourcing, pending_delivery, scheduled, delivered, complete, lost
- `stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT now()` — deal rotting calculation
- `lost_reason TEXT` — populated when pipeline_stage = 'lost'
- `lost_reason_detail TEXT` — free text
- `version INTEGER NOT NULL DEFAULT 1` — optimistic locking
- `store_id UUID REFERENCES stores(id)` — multi-store ready
- `clawback_status TEXT` — null, 'flagged', 'confirmed', 'resolved'
- `clawback_date TIMESTAMPTZ`
- `clawback_reason TEXT`
- `deleted_at TIMESTAMPTZ` — soft delete

---

## 2. Activity Events — Universal Audit Trail / Timeline (Task 2)

Every competitor has an activity timeline on every record. The system currently has NO audit trail. This is both a UX requirement and a legal requirement for dealerships.

### 2.1 Schema

```sql
CREATE TABLE activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id),

  -- What happened
  event_type TEXT NOT NULL,
  -- Values: 'stage_change', 'field_update', 'note_added', 'email_sent', 'email_received',
  -- 'sms_sent', 'sms_received', 'call_logged', 'document_uploaded', 'document_signed',
  -- 'payment_received', 'payment_confirmed', 'task_created', 'task_completed',
  -- 'assignment_changed', 'status_change', 'approval_received', 'funding_confirmed',
  -- 'delivery_completed', 'delivery_failed', 'work_order_created', 'work_order_completed',
  -- 'photo_uploaded', 'checklist_item_completed', 'override_applied',
  -- 'lead_converted', 'contact_merged', 'record_created', 'record_updated'

  -- Who did it
  user_id UUID REFERENCES users(id),
  user_name TEXT, -- denormalized for display speed

  -- What record
  entity_type TEXT NOT NULL, -- 'deal', 'lead', 'contact', 'inventory', 'work_order', 'dispatch'
  entity_id UUID NOT NULL,

  -- Associated contact (for the contact timeline view)
  contact_id UUID REFERENCES contacts(id),

  -- Details
  title TEXT NOT NULL, -- human-readable: "Stage changed from Approved to Signed"
  description TEXT, -- optional longer description
  metadata JSONB DEFAULT '{}', -- flexible: {from_stage: 'approved', to_stage: 'signed'}

  -- For communication events
  channel TEXT, -- 'sms', 'email', 'phone', 'in_person', 'system'

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_entity ON activity_events(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_activity_contact ON activity_events(contact_id, created_at DESC);
CREATE INDEX idx_activity_store ON activity_events(store_id, created_at DESC);
CREATE INDEX idx_activity_type ON activity_events(event_type);
CREATE INDEX idx_activity_user ON activity_events(user_id, created_at DESC);
```

This replaces the simpler `audit_log` table from the original design. Activity events serve as both the audit trail AND the user-facing timeline. The `metadata` JSONB field captures old/new values for field changes (same format as the original audit_log `changed_fields`).

### 2.2 Backend — server/services/activityLogger.js

Export: `logActivity({ store_id, event_type, user_id, user_name, entity_type, entity_id, contact_id, title, description, metadata, channel })`

Called from EVERY route that modifies data:
1. `server/routes/deals.js` — create, update, stage change, status change, assignment change
2. `server/routes/deliveryChecklists.js` — checklist item completion, override
3. `server/routes/dispatch.js` — create, status change
4. `server/routes/contacts.js` — create, update, merge
5. `server/routes/tasks.js` — create, complete
6. Every future route

For field updates: compare old vs new values. Only log fields that actually changed. Store `{ field, old_value, new_value }` in metadata.

### 2.3 Backend — server/routes/activity.js

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/activity?entity_type=deal&entity_id=:id | Activity for a specific record |
| GET | /api/v1/activity?contact_id=:id | Activity across all records for a contact |
| GET | /api/v1/activity?store_id=:id | All activity for a store (admin view) |
| GET | /api/v1/activity?user_id=:id | All activity by a user (performance tracking) |

All endpoints support: filter by event_type, date range, channel. Cursor-based pagination (50 per page). Sorted by created_at DESC.

### 2.4 Frontend — client/src/components/activity/ActivityTimeline.jsx

Reusable component accepting `entity_type + entity_id` OR `contact_id`.

Each entry renders:
- **Left:** Colored icon based on event_type (ArrowRight for stage changes, MessageSquare for SMS, Mail for email, Phone for calls, FileText for documents, DollarSign for payments, Pencil for edits, Plus for creates)
- **Center:** Title (bold) + description + metadata details
- **Right:** Relative timestamp ("2 hours ago") with full timestamp on hover

Filter tabs: All | Notes | Communications | Changes | Documents | Payments

Infinite scroll pagination.

Embedded in: ContactDetail center column, DealDetail (future), LeadDetail (future).

---

## 3. Global Search — Cmd+K Command Palette (Task 3)

### 3.1 Backend — server/routes/search.js

```
GET /api/v1/search?q=:query&types=:types
```

Search across multiple tables using PostgreSQL full-text search:
- **Contacts:** search `search_vector` column (created in Task 1)
- **Deals:** add `search_vector` column populated from customer name, vehicle info, stock number

```sql
ALTER TABLE deals ADD COLUMN search_vector tsvector;
CREATE INDEX idx_deals_search ON deals USING gin(search_vector);
```

Response:
```json
{
  "results": [
    { "type": "contact", "id": "...", "title": "John Smith", "subtitle": "(514) 555-1234", "url": "/contacts/abc123" },
    { "type": "deal", "id": "...", "title": "John Smith — 2022 Kia Forte", "subtitle": "Approved · $22,000", "url": "/deal/abc123" }
  ],
  "total": 12
}
```

- 5 results per type, 20 total max
- Ranked by relevance
- Partial matching for: phone (last 4 digits), VIN (last 6 chars), stock numbers (prefix)

### 3.2 Frontend — client/src/components/search/CommandPalette.jsx

- **Trigger:** Ctrl+K / Cmd+K, or click search input in top bar
- **Modal overlay** with autofocus search input
- Results grouped by type with type headers
- Each result: icon + title + subtitle + type badge
- Keyboard navigation: arrow keys, Enter to select, Esc to close
- Recent searches in localStorage (last 5)
- Debounce input 200ms
- Loading spinner, empty state

Wire into Layout.jsx: keyboard listener at layout level. Replace non-functional search input with palette trigger.

---

## 4. Tasks / Follow-Ups (Task 4)

### 4.1 Schema

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,

  -- Assignment
  assigned_to UUID REFERENCES users(id) NOT NULL,
  created_by UUID REFERENCES users(id) NOT NULL,

  -- Task details
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL DEFAULT 'follow_up', -- 'call', 'email', 'text', 'meeting', 'follow_up', 'document', 'other'
  priority TEXT DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'

  -- Timing
  due_date TIMESTAMPTZ NOT NULL,
  reminder_at TIMESTAMPTZ,

  -- Status
  status TEXT DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'cancelled', 'overdue'
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),

  -- Related record
  entity_type TEXT, -- 'deal', 'lead', 'contact', 'inventory', 'work_order'
  entity_id UUID,
  contact_id UUID REFERENCES contacts(id),

  -- Recurrence
  is_recurring BOOLEAN DEFAULT false,
  recurrence_pattern TEXT, -- 'daily', 'weekly', 'monthly'
  recurrence_end_date DATE,
  parent_task_id UUID REFERENCES tasks(id),

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ, -- soft delete
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_tasks_assigned ON tasks(assigned_to, status, due_date);
CREATE INDEX idx_tasks_entity ON tasks(entity_type, entity_id);
CREATE INDEX idx_tasks_due ON tasks(due_date) WHERE status = 'pending';
CREATE INDEX idx_tasks_overdue ON tasks(status, due_date) WHERE status = 'pending';
CREATE INDEX idx_tasks_contact ON tasks(contact_id);
```

### 4.2 Backend — server/routes/tasks.js

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/tasks | List (filters: assigned_to, status, type, priority, due_date range, entity, contact, overdue). Store scoped. |
| GET | /api/v1/tasks/:id | Single task |
| POST | /api/v1/tasks | Create. Log activity on related entity. |
| PUT | /api/v1/tasks/:id | Update |
| PUT | /api/v1/tasks/:id/complete | Mark completed. Log activity. If recurring, auto-create next instance. |
| DELETE | /api/v1/tasks/:id | Soft delete |
| GET | /api/v1/tasks/my | Current user's tasks, sorted by due_date |
| GET | /api/v1/tasks/overdue | All overdue tasks for the store (managers) |

### 4.3 server/jobs/taskOverdueChecker.js

Scheduled job (every 15 minutes):
- Find tasks where `status='pending'` AND `due_date < NOW()`
- Update status to 'overdue'
- Create notification for assigned user

### 4.4 Frontend — client/src/components/tasks/

**TasksDashboard.jsx** — "My Tasks" view. Three sections:
- **Overdue** (red header, sorted oldest first)
- **Due Today** (amber header)
- **Upcoming** (grouped by date)

Each task: checkbox (complete), title, type icon, priority dot, due date, related record link. Click to expand inline.

**TaskForm.jsx** — Create/edit. Fields: title, type, priority, due date+time, reminder, description, related record (search via Task 3 API).

**TaskWidget.jsx** — Compact widget showing next 5 tasks. Embedded in Dashboard above deals grid.

**QuickTaskButton.jsx** — Floating "+" on every detail page. Opens TaskForm pre-populated with current entity.

**Routing:**
- `/tasks` → TasksDashboard
- "Tasks" in sidebar with CheckSquare icon + overdue count badge
- EN/FR translations

---

## 5. Authentication — Supabase Auth + RBAC (Task 5)

### 5.1 Supabase Auth

Replace custom email-only login with Supabase's built-in auth system.

**Login flow:**
1. User signs in via `supabase.auth.signInWithPassword({ email, password })`
2. Supabase returns JWT access token + refresh token
3. Frontend stores tokens via Supabase SDK (automatic refresh)
4. Every API request includes `Authorization: Bearer <access_token>`
5. Server verifies via `supabase.auth.getUser(token)`

**Account creation:** Admin-only. `supabase.auth.admin.inviteUserByEmail(email)`

**MFA:** Supabase Auth TOTP. Required for owner, gm, admin. Optional for others.

**Password reset:** `supabase.auth.resetPasswordForEmail(email)`

### 5.2 Backend Middleware

**server/middleware/auth.js — authenticateUser:**
1. Extract Bearer token from Authorization header
2. Verify via `supabase.auth.getUser(token)`
3. Fetch user profile (role, store_id) from users table
4. Attach to `req.user`
5. Set Postgres session variable: `SET LOCAL app.current_user_id = '<uuid>'`

**server/middleware/authorize.js:**
- `requireRole(...allowedRoles)` — checks req.user.role
- `scopeToStore()` — filters by req.user.store_id (unless role is 'owner')
- `scopeToOwnDeals()` — for salesperson role, filters by assigned salesperson

Applied to ALL routes except `/api/v1/health` and `/api/v1/auth/*`.

**Rate limiting:** `express-rate-limit` on auth endpoints: 5 attempts per 15 min per IP.

### 5.3 Backend — server/routes/auth.js

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/auth/login | Email + password → JWT + user profile |
| POST | /api/v1/auth/logout | Invalidate session |
| POST | /api/v1/auth/refresh | Refresh JWT |
| GET | /api/v1/auth/me | Current user profile from JWT |
| POST | /api/v1/auth/reset-password | Trigger password reset email |
| PUT | /api/v1/auth/change-password | Change password (requires current) |

### 5.4 Users Table

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY, -- matches auth.users.id
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'owner', 'gm', 'sales_manager', 'used_car_manager', 'fi_agent',
    'salesperson', 'wholesale_manager', 'logistics', 'admin_office', 'receptionist'
  )),
  store_id UUID REFERENCES stores(id),
  language_pref TEXT NOT NULL DEFAULT 'fr',
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  mfa_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
```

### 5.5 RBAC Matrix

| Endpoint | Roles Allowed |
|----------|---------------|
| GET /deals | All authenticated |
| POST /deals | All except logistics, receptionist |
| DELETE /deals/:id | owner, gm, sales_manager |
| GET /reports/financial-summary | owner, gm, fi_agent |
| GET /reports/export/:format | owner, gm, fi_agent |
| PUT /salespeople/:id | owner, gm |
| DELETE /salespeople/:id | owner, gm |
| POST /users (create account) | owner |
| /salespeople management | owner, gm, sales_manager |

### 5.6 Row-Level Visibility

| Role | Deals | Financial Fields | Commissions |
|------|-------|-----------------|-------------|
| owner | All stores | Full | Full |
| gm | Own store | Full | Full |
| sales_manager | Own store | Full | Own team |
| fi_agent | Own store | Full | Hidden |
| salesperson | Own deals only | Sale price only | Own only |
| logistics | Delivery-related only | Hidden | Hidden |

### 5.7 Frontend Auth Changes

**client/src/contexts/AuthContext.jsx:**
- Store JWT in memory (NOT localStorage)
- Store user profile (role, store_id, name) in state
- Provide login(), logout(), refreshToken()
- Check existing session on app load
- Auto-refresh token before expiry
- Redirect to /login on 401

**client/src/components/auth/ProtectedRoute.jsx:**
- Wraps routes requiring authentication
- Accepts `requiredRoles` prop
- Shows "Access Denied" for wrong role

**Route restrictions:**
- `/salespeople` → owner, gm, sales_manager
- `/reports` → owner, gm, sales_manager, fi_agent
- Dashboard, deals, contacts, tasks → all authenticated
- All API calls include JWT via centralized api.js client

---

## 6. Soft Deletes Everywhere (Task 6)

### 6.1 Migrations

```sql
ALTER TABLE deals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE delivery_checklists ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE sourced_units ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE dispatch_assignments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE salespeople ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE chaser_vehicles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE dealer_plates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX idx_deals_not_deleted ON deals(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_salespeople_not_deleted ON salespeople(id) WHERE deleted_at IS NULL;
```

Contacts, tasks, and users already have `deleted_at` from their schemas above.

### 6.2 Application Changes

- All SELECT queries add `WHERE deleted_at IS NULL` unless requesting archived records
- All DELETE operations change to `UPDATE SET deleted_at = NOW()`
- Add `GET /api/v1/:resource/archived` endpoint for soft-deleted records
- Add `PUT /api/v1/:resource/:id/restore` endpoint to set `deleted_at = NULL`
- Keep ON DELETE CASCADE constraints as safety net for truly orphaned records

---

## 7. Input Validation Layer (Task 7)

### 7.1 Middleware — server/middleware/validate.js

```javascript
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues
      });
    }
    req.validated = result.data;
    next();
  };
}
```

### 7.2 Schemas — server/schemas/

**deals.js:**
- VIN: 17 alphanumeric (no I, O, Q), optional — regex `/^[A-HJ-NPR-Z0-9]{17}$/`
- Phone: strip non-digits, 10-11 digits
- sale_price_cents, vehicle_cost_cents, fi_reserve_cents: `z.number().int().min(0)`
- Email: valid format or null
- pipeline_stage: `z.enum(['new','submitted','approved','signed','sourcing','pending_delivery','scheduled','delivered','complete','lost'])`
- finance_status: `z.enum(['pending','approved','funded'])`
- province: `z.enum(['ON','QC','AB','BC','MB','SK','NB','NS','PE','NL','NT','YT','NU'])`

**contacts.js:**
- first_name, last_name: required, 1-100 chars, trimmed
- Phone: strip non-digits, 10-11 digits
- Email: valid format or null
- postal_code: Canadian format (A1A 1A1) or null
- preferred_language: `z.enum(['en', 'fr'])`

**tasks.js:**
- title: required, 1-200 chars
- due_date: valid ISO date, must be in the future for new tasks
- task_type: valid enum
- priority: valid enum

### 7.3 Sanitization

Applied to all string fields before validation:
- Trim whitespace
- Normalize phone numbers to digits-only
- Lowercase emails

Apply `validate()` middleware to every POST and PUT route.

---

## 8. Stores Table — Multi-Store Foundation (Task 8)

### 8.1 Schema

```sql
CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL, -- 'kia-mont-laurier', 'ready-auto'
  province TEXT NOT NULL, -- 'ontario', 'quebec'
  address TEXT,
  city TEXT,
  postal_code TEXT,
  phone TEXT,
  email TEXT,
  twilio_number TEXT,
  bill_of_sale_system TEXT DEFAULT 'cams', -- 'cams' or 'merlin'
  submission_platforms TEXT[] DEFAULT '{"dealertrack","creditapp"}',
  tax_rate NUMERIC DEFAULT 0.13, -- 13% Ontario, 14.975% Quebec
  esign_platform TEXT DEFAULT 'onespan',
  business_hours JSONB DEFAULT '{"monday":{"open":"09:00","close":"20:00"},"tuesday":{"open":"09:00","close":"20:00"},"wednesday":{"open":"09:00","close":"20:00"},"thursday":{"open":"09:00","close":"20:00"},"friday":{"open":"09:00","close":"20:00"},"saturday":{"open":"09:00","close":"17:00"},"sunday":null}',
  holiday_dates DATE[] DEFAULT '{}',
  alert_thresholds JSONB DEFAULT '{"vehicle_aging_days":30,"safety_overdue_days":3,"funding_overdue_days":7,"deal_rotting_days":7,"no_photos_hours":48,"recon_cost_threshold":2000}',
  logo_url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the first store
INSERT INTO stores (name, slug, province, city, tax_rate, bill_of_sale_system) VALUES
('Kia Mont-Laurier', 'kia-mont-laurier', 'quebec', 'Mont-Laurier', 0.14975, 'merlin');
```

### 8.2 Add store_id to Existing Tables

```sql
ALTER TABLE deals ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE salespeople ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE dispatch_assignments ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE delivery_checklists ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE sourced_units ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
```

All existing routes updated to filter by `store_id` using `scopeToStore` middleware.

---

## 9. Notification Bell — Lightweight (Task 9)

### 9.1 Schema

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id),
  urgency TEXT NOT NULL DEFAULT 'low', -- 'low', 'medium', 'high'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT, -- deep link: '/deal/abc123'
  related_entity_type TEXT,
  related_entity_id UUID,
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_at TIMESTAMPTZ,
  escalation_level INTEGER DEFAULT 0,
  parent_notification_id UUID REFERENCES notifications(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read, created_at DESC) WHERE read = false;
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
```

### 9.2 Backend — server/services/notify.js

Export: `notify({ user_id, store_id, urgency, title, message, link, related_entity_type, related_entity_id })`

Inserts into notifications table. Broadcasts on user-specific Supabase realtime channel.

Wire into activity logger — auto-create notifications for:
- `stage_change` on a deal → notify assigned salesperson
- `record_created` for a deal → notify store GM
- Task overdue → notify assigned user

### 9.3 Backend — server/routes/notifications.js

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/notifications | Current user's notifications (paginated, 20/page) |
| GET | /api/v1/notifications/unread-count | Returns `{ count }` |
| PUT | /api/v1/notifications/:id/read | Mark one as read |
| PUT | /api/v1/notifications/read-all | Mark all read for current user |
| PUT | /api/v1/notifications/:id/acknowledge | Acknowledge HIGH urgency notification |
| DELETE | /api/v1/notifications/:id | Delete one |

### 9.4 Escalation — server/services/escalation.js

Escalation rules (hardcoded, configurable later):

```javascript
const ESCALATION_RULES = [
  { trigger: 'high_urgency_unacknowledged', after_minutes: 10, escalate_to_role: 'sales_manager', after_minutes_2: 30, escalate_to_role_2: 'gm' },
  { trigger: 'task_overdue', after_minutes: 60, escalate_to_role: 'sales_manager' },
  { trigger: 'lead_not_contacted', after_minutes: 10, escalate_to_role: 'sales_manager', after_minutes_2: 30, escalate_to_role_2: 'gm' },
];
```

**server/jobs/escalationChecker.js** — runs every 5 minutes:
1. Find HIGH urgency notifications where `acknowledged = false` AND created_at < threshold
2. Create escalation notification for target role with `parent_notification_id`
3. Increment `escalation_level`

### 9.5 Frontend — client/src/components/notifications/NotificationBell.jsx

Replace existing non-functional bell in top bar:
- Bell icon with red badge (unread count)
- Click opens dropdown (360px wide, max 400px tall, z-9999)
- Header "Notifications" with "Mark all as read"
- Scrollable list: urgency dot (green/amber/red), title, message (truncated), relative time
- Click notification → navigate to link + mark read
- Tabs: All / Unread
- HIGH urgency notifications have "Acknowledge" button
- Poll unread count every 30s OR use Supabase realtime subscription

---

## 10. Commission Clawback Tracking (Task 10)

### 10.1 Schema Changes

```sql
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'; -- 'active', 'clawed_back', 'adjusted'
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS clawback_amount NUMERIC;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS clawback_reason TEXT;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS clawback_at TIMESTAMPTZ;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS clawback_by UUID REFERENCES users(id);
```

Deal clawback fields already added in Task 1 deals migration.

### 10.2 Backend

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/deals/:id/clawback | Body: `{ reason, amount }`. Set deal.clawback_status='confirmed'. Update commissions. Log activity. Notify salesperson + GM. |
| GET | /api/v1/commissions/clawbacks | List all clawed-back commissions |

### 10.3 Frontend

- "Flag for Clawback" button on DealDetail (visible to owner, gm, fi_agent only)
- Confirmation dialog with reason field
- Commission report: "Clawbacks" sub-section showing reversed deals

---

## 11. Bulk Operations (Task 12)

### 11.1 Backend — server/routes/bulk.js

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/bulk/deals/stage | `{ deal_ids, to_stage, reason? }` — validate transitions, log activity per deal |
| POST | /api/v1/bulk/deals/assign | `{ deal_ids, assigned_to }` |
| POST | /api/v1/bulk/tasks/complete | `{ task_ids }` |
| POST | /api/v1/bulk/tasks/assign | `{ task_ids, assigned_to }` |

Each operation:
1. Validate permissions (manager+ for cross-user operations)
2. Execute in transaction
3. Log activity per affected record
4. Return `{ succeeded: [], failed: [{ id, error }] }`

### 11.2 Frontend

Add selection mode to Dashboard and TasksDashboard:
- Checkbox on each card/row
- When 1+ selected: floating action bar at bottom with available bulk actions
- Action bar: count of selected + action buttons + "Deselect all"

---

## 12. Financial Precision — Integer Cents

### 12.1 Affected Columns

**Deals table:**
- `sale_price` → `sale_price_cents INTEGER DEFAULT 0`
- `vehicle_cost` → `vehicle_cost_cents INTEGER DEFAULT 0`
- `fi_reserve` → `fi_reserve_cents INTEGER DEFAULT 0`
- `money_down_amount` → `money_down_cents INTEGER DEFAULT 0`
- `cash_back_amount` → `cash_back_cents INTEGER DEFAULT 0`
- `lien_amount` → `lien_amount_cents INTEGER DEFAULT 0`

**Salespeople table:**
- `pad_amount` → `pad_amount_cents INTEGER DEFAULT 150000`
- `tier_threshold` → `tier_threshold_cents INTEGER`

**Commissions table:**
- `pad_amount` → `pad_amount_cents INTEGER DEFAULT 0`
- `gross_for_commission` → `gross_for_commission_cents INTEGER DEFAULT 0`
- `commission_amount` → `commission_amount_cents INTEGER DEFAULT 0`
- `override_amount` → `override_amount_cents INTEGER DEFAULT 0`

**Sourced units table:**
- `deposit_amount` → `deposit_amount_cents INTEGER DEFAULT 0`

Commission rates remain as NUMERIC(5,4) — percentages, not money. Example: 15% stored as `0.1500`.

### 12.2 Helper Library — server/lib/money.js

```javascript
const centsToDisplay = (cents) => (cents / 100).toFixed(2);
const displayToCents = (dollars) => Math.round(parseFloat(dollars) * 100);
const multiply = (cents, rate) => Math.round(cents * rate);
```

Frontend display uses `Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })`.

---

## 13. Server Architecture

### 13.1 File Structure

```
server/
├── index.js                      # Express setup, middleware stack, route mounting, graceful shutdown
├── config/
│   └── index.js                  # Zod-validated environment config
├── middleware/
│   ├── auth.js                   # authenticateUser — JWT verification, profile attachment
│   ├── authorize.js              # requireRole(), scopeToStore(), scopeToOwnDeals()
│   ├── validate.js               # validate(schema) — Zod body validation
│   ├── paginate.js               # parsePagination() — cursor/limit/sort
│   ├── errorHandler.js           # Global error handler + AppError class
│   ├── requestLogger.js          # Request ID, timing, structured logging
│   └── supabase.js               # Supabase client (SERVICE_ROLE_KEY)
├── schemas/
│   ├── contacts.js               # Contact Zod schemas
│   ├── deals.js                  # Deal Zod schemas
│   ├── tasks.js                  # Task Zod schemas
│   ├── salespeople.js            # Salesperson Zod schemas
│   ├── dispatch.js               # Dispatch Zod schemas
│   ├── delivery.js               # Delivery checklist Zod schemas
│   ├── sourcedUnits.js           # Sourced unit Zod schemas
│   └── common.js                 # Shared: uuid, pagination, money, province enums
├── routes/
│   ├── auth.js                   # Login, logout, refresh, reset-password, change-password
│   ├── contacts.js               # NEW — Contact CRUD, merge, find-duplicates
│   ├── deals.js                  # Refactored — contact_id, cents, pagination, validation, activity logging
│   ├── tasks.js                  # NEW — Task CRUD, complete, my, overdue
│   ├── activity.js               # NEW — Activity timeline queries
│   ├── search.js                 # NEW — Global search across entities
│   ├── notifications.js          # NEW — Notification CRUD, unread count
│   ├── bulk.js                   # NEW — Bulk operations
│   ├── salespeople.js            # Refactored — validation, auth, store scoping
│   ├── deliveryChecklists.js     # Refactored — validation, auth, activity logging
│   ├── sourcedUnits.js           # Refactored — validation, auth
│   ├── dispatch.js               # Refactored — atomic assignment, validation, auth, activity logging
│   ├── reports.js                # Refactored — auth, role-based field filtering
│   ├── email.js                  # Refactored — bilingual templates, XSS escaping
│   └── upload.js                 # Refactored — MIME whitelist, auth
├── services/
│   ├── activityLogger.js         # NEW — logActivity() called from all routes
│   ├── notify.js                 # NEW — notify() for creating notifications
│   ├── escalation.js             # NEW — escalation rules and logic
│   ├── commission.js             # Extracted — integer math, proper rounding
│   ├── dispatch.js               # Refactored — atomic plate/chaser assignment
│   ├── email.js                  # Refactored — bilingual templates per customer language
│   └── reportGenerator.js        # Refactored — streaming for large datasets
├── jobs/
│   ├── taskOverdueChecker.js     # NEW — marks overdue tasks every 15 min
│   └── escalationChecker.js      # NEW — escalates unacknowledged notifications every 5 min
├── lib/
│   ├── money.js                  # Cents ↔ display, safe arithmetic
│   ├── logger.js                 # Pino structured JSON logger
│   └── errors.js                 # AppError class, error codes enum
└── __tests__/
    ├── routes/
    ├── services/
    └── middleware/
```

### 13.2 Middleware Stack (index.js)

```javascript
app.use(helmet());
app.use(cors({ origin: config.ALLOWED_ORIGINS.split(','), credentials: true }));
app.use(express.json());
app.use(requestLogger);
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// Auth routes (rate limited more aggressively)
app.use('/api/v1/auth', authRateLimit, authRouter);

// All other routes require authentication
app.use('/api/v1/contacts', authenticateUser, contactsRouter);
app.use('/api/v1/deals', authenticateUser, dealsRouter);
app.use('/api/v1/tasks', authenticateUser, tasksRouter);
app.use('/api/v1/activity', authenticateUser, activityRouter);
app.use('/api/v1/search', authenticateUser, searchRouter);
app.use('/api/v1/notifications', authenticateUser, notificationsRouter);
app.use('/api/v1/bulk', authenticateUser, bulkRouter);
app.use('/api/v1/salespeople', authenticateUser, salespeopleRouter);
app.use('/api/v1/delivery-checklists', authenticateUser, deliveryChecklistsRouter);
app.use('/api/v1/sourced-units', authenticateUser, sourcedUnitsRouter);
app.use('/api/v1/dispatch', authenticateUser, dispatchRouter);
app.use('/api/v1/reports', authenticateUser, reportsRouter);
app.use('/api/v1/email', authenticateUser, emailRouter);
app.use('/api/v1/upload', authenticateUser, uploadRouter);

// Health (no auth)
app.get('/api/v1/health', healthCheck);

// Error handler (must be last)
app.use(errorHandler);
```

### 13.3 Config Validation

```javascript
const configSchema = z.object({
  PORT: z.coerce.number().default(3001),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  DEAL_CLOSING_EMAIL: z.string().min(1),
  DRIVER_DISPATCH_EMAIL: z.string().min(1),
  EMAIL_FROM: z.string().email(),
  APP_VERSION: z.string().default('2.0.0'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
```

Server refuses to start if any required var is missing.

### 13.4 Graceful Shutdown

SIGTERM handler: stop accepting connections → drain in-flight requests (10s timeout) → exit.

### 13.5 Deep Health Check

`GET /api/v1/health`: database ping, storage check. Returns 200/503 with per-check status.

---

## 14. Frontend Architecture

### 14.1 New Provider Stack (main.jsx)

```
QueryClientProvider → AuthProvider → ThemeProvider → ToastProvider → BrowserRouter → App
```

### 14.2 Centralized API Client — lib/api.js

- Injects Bearer token from Supabase session
- Handles 401 → sign out + redirect
- Throws structured ApiError
- Convenience: `api.get()`, `api.post()`, `api.put()`, `api.del()`

### 14.3 Error Boundary

Each route wrapped independently. Crash shows fallback UI, not blank screen.

### 14.4 Toast Notifications

- `toast.success()` — green, 5s
- `toast.error()` — red, persistent
- `toast.info()` — blue, 5s
- Framer Motion animated, stacked top-right

### 14.5 Updated Routes (App.jsx)

```
/login          → Login (email + password)
/contacts       → ContactsDashboard
/contacts/:id   → ContactDetail
/               → Dashboard
/deal/new       → DealForm
/deal/:id       → DealDetail
/tasks          → TasksDashboard
/deliveries     → DeliveryDashboard
/dispatch       → DispatchDashboard
/reports        → ReportsDashboard
/salespeople    → SalespeopleManager
```

### 14.6 Updated Sidebar (Layout.jsx)

1. Contacts (Users icon) — NEW, top position
2. Dashboard (LayoutDashboard icon)
3. New Deal (PlusCircle icon)
4. Tasks (CheckSquare icon) — NEW, with overdue badge
5. Deliveries (Truck icon)
6. Dispatch (Navigation icon)
7. Reports (BarChart3 icon)
8. Salespeople (UserCog icon) — role-restricted

### 14.7 Component Migration

| Component | Changes |
|-----------|---------|
| App.jsx | AuthProvider wraps app, ErrorBoundary per route, new routes for contacts/tasks |
| Login.jsx | Email+password via Supabase Auth, forgot password, French-first |
| Layout.jsx | useAuth() hook, role-based nav, NotificationBell, CommandPalette trigger |
| Dashboard.jsx | api.get(), pagination, role-filtered fields, TaskWidget embedded |
| DealForm.jsx | Contact selector (search/create), money→cents, version for locking |
| DealDetail.jsx | Contact profile link, ActivityTimeline tab, clawback button, QuickTaskButton |
| ReportsDashboard.jsx | Role-based tabs, clawbacks sub-section |
| SalespeopleManager.jsx | Role-restricted (owner/gm/sales_manager) |
| All components | Use api.js, no direct Supabase data queries |

---

## 15. New Dependencies

### Server
| Package | Purpose |
|---------|---------|
| `zod` | Input validation |
| `helmet` | Security headers |
| `express-rate-limit` | Rate limiting |
| `pino` | Structured JSON logging |
| `pino-pretty` | Dev log formatting |
| `escape-html` | XSS prevention in emails |

### Client
No new dependencies. Existing stack covers all needs: Supabase SDK (auth), TanStack Query (useInfiniteQuery), Framer Motion (toasts/animations), Lucide (icons), @hello-pangea/dnd (future kanban).

---

## 16. Migration Strategy

Since breaking changes are allowed:

1. **Create new tables:** stores, contacts, deal_parties, activity_events, tasks, notifications
2. **Alter existing tables:** Add store_id, contact_id, deleted_at, version, pipeline_stage, clawback fields, search_vector, commission status columns
3. **Rename money columns** to `_cents` suffix, multiply existing values by 100
4. **Migration script** to create contact records from unique customer_name values in deals and link them
5. **Seed** the first store record
6. **Restructure server** per new file layout
7. **Update frontend** to new auth flow, API client, providers, and routes
8. **Verify** all existing features work on new foundation

---

## 17. What This Spec Does NOT Cover

Explicitly out of scope (addressed in future tiers):

- Kanban pipeline UI (Tier 1 — uses pipeline_stage from this foundation)
- Workflow automation engine (Tier 1 — uses activity_events + notifications from this foundation)
- Inventory command center (Tier 1)
- Lead management (Tier 1 — will use contacts table from this foundation)
- Communication channels / unified inbox (Tier 2)
- Lender/credit integration (Tier 2)
- AI features / chatbot (Tier 3)
- Mobile PWA (Tier 2)
- Multi-store logic beyond data model (stores table ready, business logic deferred)
- Full scheduled job infrastructure (jobs directory ready, cron scheduling deferred)

This spec builds the **connective tissue** that every future module depends on.
