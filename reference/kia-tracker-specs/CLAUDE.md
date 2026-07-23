# Kia Mont-Laurier Deal Tracker

## Identity
Dealership CRM/DMS for Kia Mont-Laurier, Quebec, Canada.
Bilingual: French-first (Bill 96 compliance), English secondary.
Owner: Hassan (also operates ReadyCar, Riverside Auto Finance).

## Tech Stack
- Frontend: React 18 + Vite 5 + Tailwind CSS 3.4
- Backend: Express.js 4 + Node.js
- Database: Supabase (PostgreSQL) with real-time subscriptions
- Data fetching: @tanstack/react-query v5 (30s stale, retry 1)
- Drag-and-drop: @hello-pangea/dnd
- Icons: lucide-react
- Animations: framer-motion
- i18n: react-i18next (EN/FR)
- Email: Resend API
- Reports: PDFKit + ExcelJS

## Project Structure
```
client/              React frontend (port 5173)
  src/components/    React components
  src/hooks/         Custom hooks (useTheme)
  src/lib/           Utilities (queryClient)
  src/locales/       en.json, fr.json translations
server/              Express backend (port 3001)
  routes/            API route handlers
  services/          Business logic (email, dispatch, reportGenerator)
  middleware/        Supabase auth middleware
discussions/         Module specifications (13 spec files)
docs/                Foundation rebuild plan
supabase/            DB schema and migrations
audit/               Ralph audit system (read-only)
```

## Commands
```bash
# Development
cd client && npm run dev        # Frontend (port 5173)
cd server && npm run dev        # Backend (port 3001)

# Build
cd client && npm run build      # Production build (vite build)

# Lint (available after Story F-001)
cd client && npx eslint .
cd server && npx eslint .

# Test (available after Story F-001)
cd client && npx vitest run
cd server && npx vitest run

# Ralph verification (runs all of the above)
bash ralph.sh verify
```

## Protected Files — DO NOT MODIFY WITHOUT USER APPROVAL
These files contain stable, tested business logic. Modifying them risks breaking critical financial calculations, integrations, or the design system.

| File | Contains |
|------|----------|
| `server/routes/deals.js` | Deal CRUD + commission calculations for 12 salespeople |
| `server/services/dispatch.js` | Fleet assignment algorithm + 4hr conflict detection |
| `server/services/reportGenerator.js` | PDF/Excel export engine (4 report types) |
| `server/services/email.js` | Resend integration + HTML email templates |
| `client/src/index.css` | "KIA Command" design tokens (CSS custom properties, light/dark) |
| `client/tailwind.config.js` | Tailwind design system configuration |
| `client/src/supabaseClient.js` | Supabase client singleton |
| `server/middleware/supabase.js` | Supabase service role client |
| `supabase-migration.sql` | Production schema (append-only — add migrations, never edit) |
| `supabase/schema.sql` | Base schema reference |

## Extended Files — ADD TO, DO NOT REMOVE FROM
| File | What you can add | What you cannot remove |
|------|-----------------|----------------------|
| `server/index.js` | New route registrations | Existing route registrations |
| `client/src/App.jsx` | New route definitions | Existing routes, auth logic |
| `client/src/locales/en.json` | New translation keys | Any existing keys |
| `client/src/locales/fr.json` | New translation keys | Any existing keys |
| `client/src/components/Layout.jsx` | New nav items | Existing nav structure, sidebar logic |

## Branch Rules
- `master` — production-ready only, never commit directly
- `develop` — integration branch, all features merge here
- `foundation/<system-name>` — Tier 0 foundation systems
- `feature/<module>/<short-name>` — Tier 1-2 feature work
- `fix/<short-name>` — bug fixes

## Architecture Patterns
- **Supabase client:** Import from `server/middleware/supabase.js` (server) or `client/src/supabaseClient.js` (client). Never create new instances.
- **Data fetching:** Always use React Query (useQuery/useMutation). Never raw fetch() for data that should be cached.
- **Icons:** lucide-react only. Never raw SVGs.
- **i18n:** Every user-facing string goes through `t()`. Add keys to both en.json AND fr.json.
- **CSS:** Tailwind utility classes + CSS custom properties from index.css. No inline styles, no raw color values.
- **Money:** Integer cents in DB. Format for display only at UI boundary. (After Story F-007)
- **API pattern:** Express router → validation → auth middleware → business logic → Supabase → response

## Reference Documents
- `discussions/PROJECT-HANDOFF.md` — Full project overview and current state
- `discussions/BUILT-VS-PLAN.md` — Module completion status and gaps
- `docs/KIA-DEAL-TRACKER-FOUNDATION-PLAN.md` — Foundation rebuild plan (12 systems)
- `discussions/*.spec.md` — Individual module specifications

---

## Self-Healing Workflow

### On Build Failure
1. Read the EXACT error message — don't guess
2. Fix only what the error says is broken
3. Run build again to verify
4. If same error persists after 2 attempts, stop and ask the user

### On Test Failure
1. Read the test output carefully — which test, what assertion, expected vs actual
2. Determine if the test is wrong or the code is wrong (check git blame on the test)
3. Fix the root cause, not the symptom
4. Run only the failing test first, then full suite
5. If same test fails after 2 attempts, stop and ask the user

### On Lint/Type Errors After Edit
1. If a PostToolUse hook reports errors, fix them immediately in your next action
2. Don't continue building features on top of broken code
3. Type errors and lint errors are not "warnings to fix later" — they are blockers

### On Git Conflicts
1. Never force-push or reset --hard without asking
2. Read the conflict markers carefully
3. Understand both sides before resolving
4. Prefer the incoming change if it's from develop

### On Unknown Errors
1. Read the full error (don't truncate)
2. Check if it's a known issue (search codebase for similar error strings)
3. Check if environment is correct (node version, env vars, dependencies installed)
4. If stuck after 2 attempts, explain what you tried and ask for help

### Worktree Isolation for Risky Changes
- For any change touching more than 5 files, use a git worktree
- For any refactor, use a git worktree
- The worktree is disposable — if the fix is wrong, delete it, main is untouched
- Only merge worktree back after: build passes, tests pass, lint is clean

---

## Ralph Workflow

When running in Ralph loop mode, follow this sequence EVERY iteration:

1. **Read guardrails.md** — follow ALL Signs as immutable constraints
2. **Read progress.txt** — learn from previous iterations, avoid repeating mistakes
3. **Read prd.json** — find the highest-priority story where `"status": "not_started"`
4. **Read the story's specFile** — understand full requirements from the linked spec document
5. **Check protected files** — if the story requires modifying a protected file, STOP, log in progress.txt, skip to next story
6. **Create feature branch** — `git checkout -b foundation/<name> develop` or `feature/<module>/<name> develop`
7. **Implement ONLY that one story** — write code + write tests for each acceptance criterion
8. **Run verification** — `bash ralph.sh verify`. Fix failures up to 3 times.
9. **If pass:** Update prd.json status to `"completed"`, append summary to progress.txt, commit with message `feat(<module>): <description>`
10. **If stuck 3 times:** Log blocker in progress.txt, append a new Sign to guardrails.md, skip to next story
11. **If ALL stories in current tier pass:** Output `<promise>COMPLETE</promise>`

---

## Operating Directives

- **Complete tasks in full.** Working code, tested, with edge cases handled. Not a plan. Not a partial.
- **Self-heal.** If code errors, read the error, fix it, re-run. Loop up to 3 times before surfacing the problem.
- **Self-verify.** Before presenting anything, run it. Never hand over code you haven't watched succeed.
- **Assume 6-hour response time.** Make every decision you can without asking. Ship the most reasonable version, document what you assumed.
- **Ambiguity is not a blocker.** Pick the most reasonable interpretation, mark it [ASSUMED], and keep building.
- **Sub-tasks don't need approval.** Creating helpers, installing packages, restructuring files, writing tests — just do it.
- **Leave code better than you found it.** If adjacent code is broken or poorly structured, fix it while you're in there.
- **No preamble, no narration, no permission requests.** First word of response = first word of answer.
- **Disagree immediately** if an approach is wrong. Concrete over abstract.
