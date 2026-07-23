# GUARDRAILS — Kia Deal Tracker

> Rule: Read this file at the start of EVERY iteration.
> Rule: Treat ALL Signs as immutable constraints.
> Rule: When you discover a new failure pattern, APPEND a new Sign below the marker at the bottom.
> Rule: NEVER delete or modify existing Signs.

---

## Base Signs

### SIGN-001: Verify Before Complete
Trigger: About to output COMPLETE
Instruction: Re-read prd.json. Confirm the current story passes ALL acceptance criteria. Run `bash ralph.sh verify`. Only then mark complete.

### SIGN-002: One Task Per Iteration
Trigger: Starting work
Instruction: Pick ONE story from prd.json. Complete it fully. Never start a second story in the same iteration.

### SIGN-003: Don't Break Existing Tests
Trigger: Before committing
Instruction: Run full test suite (`bash ralph.sh verify`). Fix regressions before committing. Never commit with failing tests.

### SIGN-004: Never Touch Protected Files
Trigger: About to modify a file listed under "Protected Files" in CLAUDE.md
Instruction: STOP. Log in progress.txt: "BLOCKED — Story [ID] requires modifying protected file [path]". Skip to next story. Only the user can approve protected file changes.

### SIGN-005: Feature Branch Only
Trigger: About to commit
Instruction: Verify you are on a feature/* or foundation/* branch, NOT master or develop. Run `git branch --show-current` to confirm.

### SIGN-006: No Hardcoded Config
Trigger: Writing API keys, URLs, credentials, port numbers, email addresses
Instruction: All config goes in .env files or Supabase settings. Never hardcode secrets or environment-specific values.

### SIGN-007: Read Progress First
Trigger: Starting a new iteration
Instruction: Read progress.txt and guardrails.md BEFORE doing anything else. Learn from previous iterations.

### SIGN-008: Stuck Equals Skip
Trigger: Same error 3 times in a row
Instruction: STOP. Log the blocker in progress.txt with full error details. Append a new Sign if the failure reveals a pattern. Move to next story.

---

## Architecture Signs

### SIGN-009: Single Supabase Client
Trigger: About to create or import a Supabase client
Instruction: Client-side: import from `client/src/supabaseClient.js`. Server-side: import from `server/middleware/supabase.js`. Never create new Supabase client instances.

### SIGN-010: React Query for Data Fetching
Trigger: About to use raw fetch() or axios for data that should be cached/revalidated
Instruction: Use @tanstack/react-query (useQuery/useMutation). The queryClient is already configured in `client/src/lib/queryClient.js` with 30s stale time and retry 1.

### SIGN-011: Money as Integer Cents
Trigger: Storing or calculating money values (after F-007 is complete)
Instruction: All money stored as integer cents in the database. $1,000.00 = 100000 cents. Use integer arithmetic. Format for display only at the UI boundary.

### SIGN-012: Soft Delete Required
Trigger: Creating a new database table (after F-007 is complete)
Instruction: Every table must have a `deleted_at` timestamp column. All queries must filter `WHERE deleted_at IS NULL` by default.

### SIGN-013: Store Scoping Required
Trigger: Creating queries or API endpoints (after F-004 is complete)
Instruction: Every query must scope by `store_id`. Use the scopeToStore() middleware. Owner role sees all stores; other roles see only their assigned store.

### SIGN-014: i18n Required for All User-Facing Text
Trigger: Adding any text visible to users (labels, messages, tooltips, errors)
Instruction: Wrap in `t()` function. Add keys to BOTH `client/src/locales/en.json` AND `client/src/locales/fr.json`. No hardcoded English strings in JSX.

### SIGN-015: Component Size Limit
Trigger: Component file exceeds 400 lines
Instruction: Split into subcomponents. Extract logic into custom hooks. A single component file should have one clear responsibility.

---

## Supabase Signs

### SIGN-016: Specify Columns in Select
Trigger: Writing a Supabase `.select()` call
Instruction: Always specify column names: `.select('id, name, status')`. Never use `.select('*')` — it hurts performance and leaks schema.

### SIGN-017: Filter Deleted Records
Trigger: Writing any Supabase query (after F-007 is complete)
Instruction: Add `.is('deleted_at', null)` to every query unless explicitly fetching deleted records for admin view.

### SIGN-018: Safe RLS Policies
Trigger: Creating Row Level Security policies
Instruction: Never use `USING (true)` with `WITH CHECK (true)`. Always scope by `auth.uid()` or `store_id`. Test that unauthorized users cannot read/write.

### SIGN-019: Schema Changes via Migrations Only
Trigger: Need to change database schema
Instruction: Create a new file in `supabase/migrations/` named `YYYYMMDD_description.sql`. Never alter tables directly in the Supabase dashboard or via ad-hoc SQL.

### SIGN-020: Use RPC for Bulk Operations
Trigger: Need to update/insert more than 10 rows
Instruction: Use `supabase.rpc()` with a server-side function instead of looping individual `.update()` calls. Bulk loops are slow and can hit rate limits.

---

## API Signs

### SIGN-021: Input Validation Required
Trigger: Creating or modifying an API endpoint that accepts user input (after F-006 is complete)
Instruction: Use Zod schema validation via `validate()` middleware. Validate at the route level before any business logic executes.

### SIGN-022: Authentication Required
Trigger: Creating or modifying an API endpoint (after F-005 is complete)
Instruction: Apply `authenticateUser` middleware to every route except health check. No anonymous access to data endpoints.

### SIGN-023: Role Check Required
Trigger: Creating or modifying an API endpoint (after F-005 is complete)
Instruction: Apply `requireRole()` middleware after authentication. Principle of least privilege — salespeople see own data only, managers see team data, owners see all.

### SIGN-024: No Raw Supabase Errors to Client
Trigger: Catching a Supabase error in an API route
Instruction: Log the full error server-side. Return a sanitized error message to the client. Never expose table names, column names, or constraint names.

### SIGN-025: Error Handling on Every Supabase Call
Trigger: Making a Supabase call in a route or service
Instruction: Check `{ data, error }` response. If `error`, handle it (log + return appropriate HTTP status). Never ignore the error field.

---

## Git Signs

### SIGN-026: Protected File Check Before Commit
Trigger: About to `git add` or `git commit`
Instruction: Run `bash ralph.sh guard`. If it flags a protected file, STOP. Do not commit.

### SIGN-027: No Debug Code in Commits
Trigger: About to commit
Instruction: Search staged files for `console.log`, `debugger`, `TODO`, and `FIXME`. Remove or convert to proper logging before committing.

### SIGN-028: No Secrets in Commits
Trigger: About to commit
Instruction: Check that no `.env` files are staged: `git diff --cached --name-only | grep -i '.env'`. If found, unstage immediately.

### SIGN-029: Atomic Commits
Trigger: Staged changes touch more than 10 files
Instruction: Split into smaller logical commits. One commit per logical change. If a story requires 10+ file changes, commit in phases (e.g., "add migration", "add API route", "add frontend component").

### SIGN-030: No Conflict Markers
Trigger: About to commit
Instruction: Search for `<<<<<<<`, `=======`, `>>>>>>>` in staged files. If found, resolve the conflict before committing.

---

## Patterns (How We Build Things Here)

### Pattern: New API Route
1. Create `server/routes/<name>.js`
2. Add Zod validation schema at top (after F-006)
3. Apply `authenticateUser` + `requireRole()` middleware (after F-005)
4. Business logic in `server/services/<name>.js` if > 20 lines
5. Register route in `server/index.js` (extended file — add only)
6. Log activity events for all mutations (after F-008)
7. Write tests in `server/__tests__/<name>.test.js`

### Pattern: New React Component
1. Create `client/src/components/<Name>.jsx`
2. Use React Query (`useQuery`/`useMutation`) for data fetching
3. Style with Tailwind utility classes + CSS custom properties from `index.css`
4. Add i18n keys to both `en.json` and `fr.json`
5. Add route in `App.jsx` if it's a page (extended file — add only)
6. Add nav item in `Layout.jsx` sidebar if it's a top-level page (extended file — add only)
7. Write tests in `client/src/__tests__/<Name>.test.jsx`

### Pattern: New Database Table
1. Create migration: `supabase/migrations/YYYYMMDD_create_<name>.sql`
2. Required columns: `id` (UUID, default gen_random_uuid()), `created_at`, `updated_at`, `deleted_at`, `store_id` (FK), `created_by` (FK to users), `updated_by`
3. Enable RLS: `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY`
4. Create policies scoped by `store_id` + user role
5. Add indexes on foreign keys and search fields
6. Add Zod schema in the corresponding route file

### Pattern: Commission Calculation
- NEVER modify commission logic in `server/routes/deals.js` without explicit user approval
- All money in cents (integers), rates as decimals (0.25 = 25%)
- Pad is subtracted before rate is applied
- Tiered rates check monthly gross across ALL deals for that salesperson in the current period
- Override commissions go to the supervisor, not the salesperson
- After F-012: clawback status must be checked before paying out

---

## Ralph Appends New Signs Below This Line
