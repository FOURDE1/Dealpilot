# Kia Mont-Laurier Deal Tracker — Full Project Handoff

## Overview

This is a full-stack dealership CRM/deal tracking system for Kia Mont-Laurier. It's a working MVP with an in-progress UI/UX redesign based on competitive research across 8 major CRM/DMS platforms.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS 3.4 |
| Backend | Express.js (Node.js), port 3001 |
| Database | Supabase (PostgreSQL) with real-time subscriptions |
| Email | Resend API |
| i18n | react-i18next (English + French) |
| Charts | Recharts |
| Icons | Lucide React |
| Animations | Framer Motion |
| Drag & Drop | @hello-pangea/dnd |
| Data Fetching | @tanstack/react-query v5 |

---

## What's Built & Working (MVP)

### Core Features
- **Deal CRUD** — Full create/read/update/delete with all fields (vehicle info, deal details, delivery, trade-in, sold status, financials)
- **Financial tracking** — sale_price, vehicle_cost, fi_reserve fields on every deal
- **Commission system** — 12 salespeople with individual pay plans (rates, pads, tiers, overrides), auto-calculated on fund/complete
- **Dashboard** — Stats bar (7 metrics), filter bar (9 filters), deal card grid, real-time Supabase sync
- **Delivery management** — Checklist with 4 critical items + file uploads
- **Dispatch/fleet** — Chaser vehicles, dealer plates, auto-assign, conflict detection
- **Sourced units** — Seller tracking, payment proof, pickup logistics
- **Reports** — 4 tabs: Sales Performance, Commissions, Financial Summary, Inventory Pipeline
- **PDF + Excel export** — All 4 report types via exceljs + pdfkit
- **Salespeople Manager** — Add/edit/deactivate with rates, pads, tiers, overrides
- **Email automation** — Deal closing report + driver dispatch via Resend
- **EN/FR translations** — Complete for all features
- **Authentication** — Login with localStorage session persistence

### Commission Pay Plans (Real Data)

| Salesperson | Rate | Pad | Special |
|---|---|---|---|
| Vendeur 01 | 30% | None | — |
| Vendeur 02 | 20% | $1,500 | Vendeur 09 gets 5% override |
| Vendeur 03 | 25% | $1,500 | Vendeur 07 gets 5% override |
| Vendeur 04 | 20% | $1,500 | — |
| Vendeur 05 | 20% | $1,500 | — |
| Vendeur 06 | 25% | $1,500 | — |
| Vendeur 07 | 35% | $1,500 | +5% override on Vendeur 03 |
| Vendeur 08 | 5% | $1,500 | — |
| Vendeur 09 | 30% | $1,500 | +5% override on Vendeur 02 |
| Vendeur 10 | 25%/30% | $1,500 | 30% if monthly gross >$60k |
| Vendeur 11 | 20% | $1,500 | — |
| Vendeur 12 | 20% | $1,500 | — |

---

## File Structure

```
kia-deal-tracker/
├── client/
│   ├── src/
│   │   ├── App.jsx                    # Routing + auth state
│   │   ├── main.jsx                   # Entry: QueryClient + Theme + Router
│   │   ├── index.css                  # Design tokens (CSS vars, light/dark)
│   │   ├── supabaseClient.js          # Supabase client init
│   │   ├── i18n.js                    # i18next config (EN/FR)
│   │   ├── hooks/useTheme.jsx         # Theme context (dark/light, localStorage)
│   │   ├── lib/queryClient.js         # React Query config (30s stale, retry 1)
│   │   ├── components/
│   │   │   ├── Layout.jsx             # Sidebar + top bar + mobile drawer
│   │   │   ├── Dashboard.jsx          # Main deals grid + stats + filters
│   │   │   ├── DealForm.jsx           # Deal create/edit form
│   │   │   ├── DealDetail.jsx         # Full deal view (40KB, comprehensive)
│   │   │   ├── DeliveryDashboard.jsx  # Delivery management
│   │   │   ├── DeliveryChecklist.jsx  # Checklist component
│   │   │   ├── DispatchDashboard.jsx  # Dispatch management
│   │   │   ├── DispatchCard.jsx       # Individual dispatch card
│   │   │   ├── ReportsDashboard.jsx   # Reports hub
│   │   │   ├── SalespeopleManager.jsx # Sales team management
│   │   │   ├── SourcedUnitSection.jsx # Sourced units tracking
│   │   │   ├── Login.jsx              # Auth page
│   │   │   ├── FileUpload.jsx         # File upload component
│   │   │   └── reports/
│   │   │       ├── CommissionTracker.jsx
│   │   │       ├── FinancialSummary.jsx
│   │   │       ├── InventoryPipeline.jsx
│   │   │       └── SalesPerformance.jsx
│   │   └── locales/
│   │       ├── en.json                # English translations
│   │       └── fr.json                # French translations
│   ├── tailwind.config.js             # Design system config
│   ├── vite.config.js                 # Vite config (port 5173)
│   └── package.json
├── server/
│   ├── index.js                       # Express app + route registration
│   ├── routes/
│   │   ├── deals.js                   # Deal CRUD
│   │   ├── users.js                   # User management
│   │   ├── email.js                   # Email (Resend)
│   │   ├── deliveryChecklists.js      # Delivery endpoints
│   │   ├── sourcedUnits.js            # Sourced units
│   │   ├── dispatch.js                # Dispatch ops
│   │   ├── upload.js                  # File uploads (multer)
│   │   ├── reports.js                 # Report generation
│   │   └── salespeople.js             # Sales team
│   ├── services/
│   │   ├── email.js                   # Email logic
│   │   ├── dispatch.js                # Dispatch business logic
│   │   └── reportGenerator.js         # PDF/Excel generation
│   └── package.json
├── research-notes.md                  # UI/UX research (17.5KB)
├── CRM-UI-UX-RESEARCH.md             # Deep platform analysis (36KB)
├── supabase-migration.sql             # DB schema
└── CLAUDE.md                          # Dev guidelines
```

### Routes

```
GET  /login              → Login
GET  /                   → Dashboard (deals grid)
GET  /deal/new           → DealForm (create)
GET  /deal/:id           → DealDetail (view/edit)
GET  /deliveries         → DeliveryDashboard
GET  /dispatch           → DispatchDashboard
GET  /reports            → ReportsDashboard
GET  /salespeople        → SalespeopleManager
```

### API Endpoints

```
/api/deals               — Deal CRUD + stats/summary
/api/users               — User management
/api/email               — Email notifications
/api/delivery-checklists — Delivery management
/api/sourced-units       — Sourced units
/api/dispatch            — Dispatch operations
/api/upload              — File uploads
/api/reports             — Report generation
/api/salespeople         — Sales team management
/api/health              — Health check
```

---

## UI/UX Research Summary

We studied 8 major CRM/DMS platforms to inform the redesign:

### Platforms Analyzed
1. **GoHighLevel** — Slide-out panels, kanban pipeline, navy/purple theme
2. **VinSolutions** — Multi-tab deal desking, payment calculator scenarios
3. **DealerSocket** — Step-by-step F&I workflow, inventory grid with days-on-lot
4. **Reynolds & Reynolds** — Legacy terminal system, department-segmented views
5. **Salesforce Automotive** — Configurable dashboard widgets, activity timeline, path component
6. **Monday.com** — Board views (table/kanban/timeline), vibrant status colors, signature purple
7. **HubSpot** — Three-column record layout (INDUSTRY STANDARD), activity timeline, pipeline board
8. **Pipedrive** — Full-width kanban PRIMARY view, deal rotting indicator, best drag-and-drop

### Key Design Patterns We're Stealing

| Pattern | Source | Why |
|---------|--------|-----|
| Full-width Kanban as primary view | Pipedrive | Pipeline-first workflow for car deals |
| Deal rotting indicator (amber/red aging) | Pipedrive | Visual urgency for stale deals |
| Three-column record layout | HubSpot | Industry standard for detail views |
| Activity timeline on records | HubSpot/Salesforce | Chronological deal history |
| Slide-out detail panel | GoHighLevel | Context preservation (no full page nav) |
| Collapsible dark sidebar | Monday.com | Clean nav, maximizes workspace |
| Status color system (vibrant) | Monday.com | Works in both light/dark modes |
| Smooth drag-and-drop with ghost preview | Pipedrive | Best-in-class interaction |
| Board + table view toggle | HubSpot | User choice for data display |
| Bottom tab nav on mobile | Pipedrive | Native-feeling mobile experience |

### Competitive Weaknesses We're Exploiting

| Platform | Their Weakness | Our Opportunity |
|----------|---------------|-----------------|
| GoHighLevel | Cluttered, inconsistent UI | Clean, focused dealership design |
| VinSolutions | Dated 2015-era UI, slow | Modern, fast, responsive |
| DealerSocket | Bolted-on features | Unified, cohesive design from day one |
| Reynolds | Ancient UX (2005-era), no mobile | Modern-first, mobile-native |
| Salesforce | Too complex, expensive | Simple, affordable, dealership-focused |
| Monday.com | Not automotive at all | Deep automotive workflow integration |
| HubSpot | No automotive features | VIN decode, payment calc, inventory built-in |
| Pipedrive | No automotive specifics | Pipeline optimized specifically for car deals |

---

## Design System — "KIA Command"

### Approved & Implemented

**Font:** Inter (Google Fonts)

**Color System (CSS Variables):**

Light Mode:
```
Background:     #F5F7FA (page), #FFFFFF (cards)
Text:           #1A1D23 (primary), #6B7280 (secondary), #9CA3AF (muted)
Accent:         #3B82F6 (blue)
Brand Red:      #E53935 (Kia)
Border:         #E5E7EB
Success:        #10B981 / Warning: #F59E0B / Danger: #EF4444 / Info: #6366F1
```

Dark Mode:
```
Background:     #0F1117 (page), #1A1D27 (cards), #141720 (sidebar)
Elevated:       #232738 (modals, dropdowns)
Text:           #F0F2F5 (primary), #9CA3AF (secondary), #6B7280 (muted)
Accent:         #60A5FA (lighter blue for dark bg)
Brand Red:      #EF5350 (adjusted for dark bg)
Border:         #2A2D3A
Success:        #34D399 / Warning: #FBBF24 / Danger: #F87171 / Info: #818CF8
```

**Pipeline Stage Colors:**
```
New:             #3B82F6 (blue)
At Garage:       #6366F1 (indigo)
Finance Pending: #F59E0B (amber)
Approved:        #06B6D4 (cyan)
Funded:          #14B8A6 (teal)
Delivered:       #10B981 (green)
Lost:            #EF4444 (red)
```

**Transitions:**
- Fast: 150ms ease (hover states)
- Normal: 250ms ease (panels, sidebar)
- Slow: 350ms ease (page transitions)

**Custom Animations (Tailwind keyframes):**
- slide-in-right / slide-out-right (for detail panels)
- fade-in
- pulse-dot (notification indicator)

### Sidebar Navigation (Implemented)
- 240px expanded / 60px collapsed
- Dark themed (uses sidebar bg color)
- 6 nav items: Dashboard, New Deal, Deliveries, Dispatch, Reports, Salespeople
- Active state: accent bg tint + 3px left border
- Bottom controls: Theme toggle, language toggle, collapse toggle, user/logout
- Mobile: Full-screen overlay drawer with hamburger trigger
- Collapse state persisted in localStorage

### Top Bar (Implemented)
- Sticky header
- Mobile: hamburger menu button
- Desktop: Search input with "/" shortcut label
- Notification bell with animated pulse dot

---

## Redesign Progress

### Completed (Steps 1-3 of 12)
1. **Dependencies installed** — framer-motion, @hello-pangea/dnd, lucide-react, @tanstack/react-query
2. **Design system created** — Tailwind config rewritten with design tokens, index.css with full light/dark CSS variables, ThemeProvider hook with localStorage persistence
3. **Layout rebuilt** — Collapsible dark sidebar, top bar with search/notifications, mobile drawer, responsive transitions

**Build status: Clean (passes)**

### Not Yet Started (Steps 4-12)
4. **Dashboard with Kanban pipeline + list toggle** — Replace current grid cards with drag-and-drop Kanban columns by deal stage, plus a list/table view toggle
5. **Deal cards with rotting indicators + drag-drop** — Redesign deal cards with aging visual, status colors, salesperson avatar, value display
6. **Deal detail side panel** — Slides from right, tabbed interface (instead of full-page navigation)
7. **Delivery board redesign** — Apply new design system to delivery management
8. **Reports page with animated charts** — Redesign reports with Framer Motion chart animations
9. **Notification system** — Bell icon + toast notifications
10. **Dark/light theme toggle** — Already have the provider, need toggle UI throughout all views
11. **Mobile responsive** — Bottom tab navigation, horizontal pipeline scroll
12. **Polish animations** — Micro-interactions, celebrations (deal won confetti), loading skeletons

---

## Typography System (From Research)

```
Page Title:     24px / line-height 1.3 / weight 600
Section Header: 18px / 1.4 / 600
Card Title:     15px / 1.4 / 600
Body:           14px / 1.5 / 400
Label:          13px / 1.4 / 500
Caption/Meta:   12px / 1.4 / 400
Badge:          11px / 1.0 / 600 (uppercase, letter-spacing 0.5px)

Base spacing unit: 4px
Component padding: 12px or 16px
Section gaps: 24px or 32px
```

## Card Design Spec (From Research)

```
Width:          260-300px (kanban), full-width (list)
Padding:        12-16px
Background:     White (light) / card surface (dark)
Shadow:         0 1px 3px (rest), 0 4px 12px (hover)
Left border:    3-4px colored by status/stage
Content stack:
  - Deal/customer name (14px semibold, truncate)
  - Vehicle description (13px, gray)
  - Dollar value (14-16px semibold, green/brand)
  - Bottom row: Owner avatar (24px), date badge, activity icons
Max items:      4-5 info items per card
```

## Kanban Column Spec (From Research)

```
Header:
  - Stage name (bold, 14-16px)
  - Deal count in badge
  - Total dollar value
  - "Add" button per column

Drag & Drop:
  - Lift shadow: 0 8px 24px, 150ms snap
  - Column highlight: Dashed border or bg change on hover
  - Placeholder shown where card will land
  - Reordering within column supported
```

## Mobile Spec (From Research)

```
Breakpoints:
  Mobile:   < 640px  (single column, bottom nav)
  Tablet:   640-1024px (two columns, collapsible sidebar)
  Desktop:  1024-1440px (full layout)
  Wide:     > 1440px (extra sidebar or wider)

Mobile Navigation: Bottom tab bar (5 items max)
Pipeline: Horizontal scroll with snap points (85% screen width per column)
Deal cards: Full-width, swipe right = call, swipe left = move stage
Forms: Full-screen modals, 44px min touch targets, sticky submit button
```

---

## Database Schema (Key Tables)

- **deals** — All deal data (vehicle info, customer, financials, statuses, dates)
- **salespeople** — 12 salespeople with commission rates, pads, tiers, overrides
- **commissions** — Calculated commissions linked to deals + salespeople
- **delivery_checklists** — 4 critical checklist items per deal
- **sourced_units** — External vehicle sourcing tracking
- **dispatch** — Chaser vehicles, dealer plates, driver assignments

---

## How to Run

```bash
# Frontend (port 5173)
cd client && npm run dev

# Backend (port 3001)
cd server && npm run dev

# Build
cd client && npx vite build
```

**Environment variables needed:**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL`
- Server-side: Supabase service key, Resend API key

---

## Context for Planning

This document covers everything that has been built and researched. The next phase of work is the Kanban dashboard (step 4), which transforms the current grid-based deal view into a drag-and-drop pipeline organized by deal stage. The design system, theme infrastructure, and layout are already in place — the remaining work is applying the new design patterns to each feature area.
