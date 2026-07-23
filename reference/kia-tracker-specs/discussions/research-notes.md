# UI/UX Research Notes — CRM & DMS Platform Analysis

> Research for Kia Mont-Laurier Deal Tracker redesign. All 8 platforms researched.

---

## 1. GoHighLevel

### Navigation
- Left sidebar with compact icon strip; clicking opens mega-nav panels for sub-pages
- Icons at `left: 16px`, `font-size: 17px`, `padding-left: 40px`
- Collapsible right-hand sidebar in builders with 3 context-aware tabs

### Pipeline / Kanban
- Kanban board with customizable stages (New Lead, Qualified, Booked, Proposal Sent, Won/Lost)
- Deal cards ("Opportunity Cards") are draggable between columns
- Cards configurable — choose which fields display (contact name, deal value, assigned user, tags)
- Moving a card can trigger workflow automations
- Board view primary, list view also available

### Color System
| Token | Dark Theme | Usage |
|---|---|---|
| Nav background | `#00142a` | Deep navy |
| Nav text | `#ffffff` | White |
| Nav icon accent | `rgb(151, 113, 255)` | Purple |
| Hover background | `#007ef5` | Bright blue |
| Button background | `#007ef5` | Primary action |

### Typography
- Default font: **Poppins** (builders)
- Icon font-size: `17px`, button border-radius: `50px`

### Mobile
- Mobile App v4.0 (redesigned 2025): role-aware dynamic homepage
- Universal Search, App Drawer, AI assistant, true dark mode
- Tap-to-Pay invoices from chat, AI Voice Agent

### User Complaints
1. Cluttered, illogical UI — settings scattered
2. Extreme learning curve
3. CRM feels clunky — multiple screens for simple tasks
4. Workflows fire incorrectly (duplicate emails, wrong contacts)
5. Support is slow (24-48h) and unhelpful
6. Hidden costs ($475-625/month after add-ons)

---

## 2. Monday.com

### Design System: "Vibe"
- Official open-source React component library (50+ components)
- GitHub: `mondaycom/vibe`

### Color Palette
| Color | Hex | Usage |
|---|---|---|
| Monday Purple | `#6161FF` | Primary brand/accent |
| Monday Dark | `#181B34` | Dark backgrounds |
| Monday Light | `#F0F3FF` | Light backgrounds |
| Green "Done" | `#00CA72` | Complete status |
| Yellow "Working" | `#FFCC00` | In progress |
| Red "Stuck" | `#FB275D` | Blocked/stuck |

### Typography
- Primary: **Figtree**
- Secondary: **Nunito Sans**
- Body: **14px**, headings: **16px**
- Weights: 400, 500, 700

### Sidebar
- Minimum width: **244px**
- Border radius on items: **8px** (search), **20px** (interactive)
- Item padding: 6px top/bottom
- Section margin-top: 32px (main), 24px (sub)

### Kanban / Board View
- Status Column drives Kanban grouping
- Cards show selected column data inline
- Inline editing on cards without opening detail popup
- Navigation battery widget: colored progress bar showing distribution
- Cards support file covers, status badges, people avatars
- 3-dot menu: subitems, archive, delete, move, duplicate

### Theme Modes
- Light, Dark, and **Night Mode** (3 options)

### User Complaints
1. Cluttered when too many boards active
2. Email feature clunky
3. Essential features paywalled
4. Automation limits (250/month on Standard)
5. Plan cancellation banner shown to all members daily

---

## 3. Pipedrive

### Navigation
- Left sidebar with icon-based nav (up to 10 icons selectable)
- Keyboard shortcuts: 1-8 for sections, `[`/`]` for sidebar toggle
- Quick add: `.` or `+` keys
- Universal search: `/` key
- Light/dark mode toggle in Interface Preferences

### Pipeline / Kanban (widely praised as cleanest in CRM market)
- Deals as cards across customizable stage columns
- Drag-and-drop between stages

### Deal Card Structure
**5 mandatory fields:** title, contact/org, value, label (color), owner
**+ up to 7 custom fields**

**Visual indicators:**
- Activity icons (scheduled, overdue, needs attention)
- **Rotting indicator** (red) — deals stuck beyond threshold
- Color-coded labels (up to 100 per deal)
- Won = green, Lost = red

**Sorting:** 11 criteria including activity-based, value, close date

### Deal Detail Sidebar
- Opens on click from pipeline
- Sections fully customizable per user (toggle, reorder, expand/collapse)
- "Show only filled fields" filter
- Bulk edit via pencil icon in section headers
- App integrations appear as sidebar sections

### Color System
- Brand primary: Green (`#017737` to `#28B661` range)
- Dark theme: "subdued palette" reversing black/white ratio
- Deal status: Green (won), Red (lost/rotting/overdue)
- Charts support 27 custom saved colors

### Typography
- System fonts (no custom typeface)
- Email defaults: Arial 14px

### Mobile
- iOS/Android with pipeline view and drag-and-drop
- Full offline mode with sync
- AI assistant suggesting follow-ups (2026)

### User Complaints
1. Customer support is terrible — no phone support on lower plans
2. Reporting limited — surface-level metrics
3. Automation caps (50 on Growth plan)
4. Becomes expensive at scale
5. No pipeline filtering by rep or priority

---

## 4. DealerSocket

### Architecture
- Unified web-based platform: CRM + DMS (IDMS) + Inventory + Digital Retail
- Single-system approach — data entered once flows across all modules

### Deal Pipeline Stages (typical auto CRM flow)
New → Contact Attempt → Contacted → Appointment Scheduled → Dealer Visit → Demo/Test Drive → Working Deal/Negotiation → Sold → Delivered
Additional: Missed Appointment Follow-Up, Lost, Duplicate

### F&I Workflow
- SocketCredit for soft/hard credit pulls from CRM
- Desking: multiple deal scenarios with side-by-side comparison
- Seamless handoff from sales to F&I with pre-populated data

### Inventory (Inventory+)
- Elastic search with combinable filters
- TrueScore analytics — vehicle scoring based on dealership sales history
- Bulk pricing changes across groups
- Up to 12 trillion unique search configurations

### Mobile
- "Tap-and-go" optimized for dealer floor (upping customers, sending texts, finding vehicles)

---

## 5. Reynolds & Reynolds (ERA-IGNITE)

### System Design
- **Retail Management System** — single platform, one unique identifier per customer/vehicle/transaction
- Uses numbered screen codes for navigation (e.g., 4061 = Vehicle Inventory Summary)

### Key Features
- ERA-IGNITE toolbar with system icons
- Consolidated screens with reduced keystrokes
- Side-by-side deal comparison in desking
- Drill-down financial statements
- Automatic data flow from all departments to accounting
- Customizable screen appearance per user
- Embedded help videos within every screen

### Department Areas
1. Dealership-wide (analytics, marketing, security)
2. Sales (CRM, desking, online retailing, FOCUS leads)
3. Parts (inventory, pricing, margin analysis)
4. Business Office (analytics, cash flow, payroll)
5. Finance/F&I (compliance, real-time product rating, docuPAD)
6. Service (appointments, Shop View, ROs, warranty)

---

## 6. HubSpot CRM

### Deal Pipeline
- Kanban board with horizontal columns per stage
- Cards show: deal name, amount, close date, contact, company, owner avatar
- Colored left border on cards for priority/custom property
- Weighted pipeline view (probability-adjusted values)
- Board + Table view toggle
- Pipeline totals per column header
- "Add deal" button at top of each column

### Contact Record — Three-Column Layout (industry best practice)
- **Left column (280px):** Key properties (name, email, phone, company, lifecycle stage)
- **Center column (flex):** Activity timeline (emails, calls, meetings, notes — chronological feed)
- **Right column (300px):** Associations (companies, deals, tickets), sidebar cards

### Activity Feed
- Chronological timeline with filter controls (emails, calls, notes, tasks, meetings)
- Each activity: icon, type label, timestamp, preview text, expand/collapse
- Inline email threads, inline call recording playback
- Pin important activities to top
- Quick-log buttons above timeline: Note, Email, Call, Task, Meeting

### Navigation
- Top horizontal nav bar with major hubs: Contacts, Conversations, Marketing, Sales, Service, Automation, Reporting
- Dropdown mega-menus for sub-sections
- Left sidebar for list filters and saved views
- **Ctrl+K global search** — instant search across all records

### Color System
| Color | Hex | Usage |
|---|---|---|
| Brand accent | `#FF7A59` | Orange, used sparingly for CTAs |
| Primary UI | `#0091AE` | Teal-blue, links/interactive |
| Background | `#FFFFFF` / `#F5F8FA` | Primary / secondary |
| Text primary | `#33475B` | Dark gray |
| Text secondary | `#516F90` | Medium gray |

### Typography
- **Lexend Deca** and **Avenir** as primary fonts
- Headers: 20-24px semibold, body: 14px, metadata: 12px
- Line-height: 1.5

### Mobile
- Bottom tab bar: Feed, Contacts, Deals, Tasks, Menu
- Swipe to call/email from contact lists
- Business card scanner, offline access

### User Complaints
1. Pipeline only Kanban or Table (no timeline/calendar)
2. Limited deal card layout customization
3. Mobile pipeline view is cramped
4. Price jumps dramatically free → paid
5. Workflow automation UI less visual than GoHighLevel

---

## 7. Salesforce Automotive Cloud

### Dashboard
- Configurable with drag-and-drop widget placement
- Widgets: KPI cards, charts (bar, line, donut), tables, activity timelines
- Lightning App Builder for admin layout customization
- Role-based dashboards (manager vs salesperson)

### Activity Tracking
- Timeline on every record (contact, deal, vehicle)
- Chronological feed: emails, calls, tasks, stage changes, notes
- Each activity has icon, timestamp, expandable detail
- "Log a Call" and "New Task" quick actions pinned at top
- Einstein AI suggestions inline ("This lead hasn't been contacted in 5 days")

### Pipeline / Opportunity View
- Kanban with drag-and-drop + list/table toggle
- **Path component:** horizontal stepped bar at top showing stage progression
- Each stage shows guidance text and required fields

### Navigation
- Top nav bar with app launcher (waffle icon)
- Tab-style nav for objects (Leads, Contacts, Opportunities, Vehicles)
- Utility bar at bottom for quick tools
- Left sidebar for list filters
- Global search in top nav

### Color System (Lightning Design System)
| Color | Hex | Usage |
|---|---|---|
| Primary blue | `#0176D3` | CTAs, active states |
| Success | `#2E844A` | Green |
| Warning | `#DD7A01` | Yellow/amber |
| Error | `#EA001E` | Red |
| Background | `#FFFFFF` / `#F3F3F3` | Primary / secondary |
- 4px base spacing unit system

### Typography
- **Salesforce Sans** font family
- Page title: 20px bold, section headers: 16px semibold, body: 14px, metadata: 12px

### Mobile
- Full-featured Salesforce Mobile App
- Bottom tab navigation
- Card-based stacked layouts, swipe actions
- Offline capability

### User Complaints
1. Overwhelming complexity for small teams
2. Performance suffers with customizations
3. Expensive per-seat licensing
4. Requires admin expertise to configure
5. Too much clicking to reach information

---

## 8. VinSolutions (Cox Automotive)

### Deal Desking Workflow
- Structured flow: Lead → Appointment → Show → Demo → Write-up → Sold
- Multi-tab form: vehicle info, customer info, trade-in, payment calculator
- Payment calculator shows multiple scenarios side-by-side (36/48/60/72 month)
- F&I product menu integrated into deal flow

### Dashboard
- Tile-based with KPI cards at top (leads today, appointments, sold units, closing %)
- Activity feed below KPIs
- "My tasks" panel on right/below
- Manager view: team performance table/grid

### Navigation
- **Top horizontal nav bar** (not sidebar) — feels dated vs sidebar-first designs
- Mega-menu dropdowns for sub-sections
- Sections: Dashboard, Contacts, Inventory, Desking, Reports, Settings

### Color System
- Cox Automotive blue as primary brand
- White/light gray backgrounds, blue header bar
- Conservative enterprise palette
- Limited status colors (red/green/yellow)

### What Makes It Premium
- Deep automotive data integration (VIN decode, book values, OEM incentives)
- Real-time payment calculator with rate lookups
- DMS integration, ILM automation rules

### User Complaints
1. UI looks and feels dated (2015-era)
2. Slow page loads, heavy server-rendered
3. Too many clicks for common tasks
4. Poor mobile experience
5. Significant training required

---

## Design Recommendations (Top Patterns to Steal)

1. **Pipedrive's deal rotting** — visual aging of stale deals (amber → red) perfect for automotive speed-to-lead
2. **HubSpot's three-column record view** — activity timeline centered, best-in-class
3. **Monday.com's color system** — vibrant status colors that work in both light/dark mode
4. **Pipedrive's drag-and-drop** — smoothest in the industry, with visual feedback
5. **GoHighLevel's slide-out panels** — keep pipeline context while viewing deal details
6. **Monday.com's dark mode** — proper elevation hierarchy (lighter surfaces = higher)
7. **Salesforce's stage path component** — horizontal stepped bar showing deal progression
8. **HubSpot's Ctrl+K global search** — instant access to any record
9. **Pipedrive's quick-add button** — floating (+) to create deals from anywhere
10. **DealerSocket's step-by-step F&I wizard** — reduce cognitive load for complex processes

### Competitive Weaknesses to Exploit
| Platform | Their Weakness | Our Opportunity |
|---|---|---|
| GoHighLevel | Cluttered, inconsistent UI | Clean, focused dealership-specific design |
| VinSolutions | Dated UI, slow | Modern, fast, responsive |
| DealerSocket | Bolted-on features | Unified, cohesive design from day one |
| Reynolds & Reynolds | Ancient UX, no mobile | Modern-first, mobile-native |
| Salesforce | Too complex, expensive | Simple, affordable, dealership-focused |
| Monday.com | Not automotive at all | Deep automotive workflow integration |
| HubSpot | No automotive features | VIN decode, payment calc, inventory built-in |
| Pipedrive | No automotive specifics | Pipeline optimized for car deals |

---

## Dark Mode Design Tokens (from research)

### Recommended: "Slate Professional" Palette
| Token | Hex | Usage |
|---|---|---|
| `--bg-primary` | `#0F172A` | Page background (deepest) |
| `--bg-secondary` | `#1E293B` | Sidebar, panels |
| `--bg-surface` | `#334155` | Cards, elevated containers |
| `--border` | `#475569` | Dividers, card borders |
| `--text-primary` | `#F1F5F9` | Headings, body |
| `--text-secondary` | `#94A3B8` | Labels, metadata |
| `--accent` | `#38BDF8` | Buttons, links, active |
| `--success` | `#10B981` | Profit, completed |
| `--warning` | `#F59E0B` | Pending, aging |
| `--error` | `#EF4444` | Losses, overdue |

### Surface Layering (dark mode needs 3-4 lightness steps)
- L:10 — Page background
- L:14 — Sidebar/panel
- L:18 — Card/elevated surface
- L:22-25 — Card border (4-7% lighter than card)

### Contrast Ratios
- `#F1F5F9` on `#0F172A` = ~15:1 (excellent)
- `#94A3B8` on `#0F172A` = ~7:1 (passes AA)

---

## Card Component Specs

| Property | Value |
|---|---|
| Padding | `12px 16px` (compact) or `16px` (standard) |
| Border radius | `8px` |
| Border | `1px solid var(--border)` |
| Shadow (default) | `0 1px 2px rgba(0, 0, 0, 0.3)` |
| Shadow (hover) | `0 4px 6px rgba(0, 0, 0, 0.4)` |
| Hover transform | `translateY(-2px)` |
| Transition | `box-shadow 0.2s ease-in-out, transform 0.35s ease-in-out` |

---

## Toast Notification Specs

| Property | Value |
|---|---|
| Max width | `400px` |
| Padding | `1rem` |
| Border radius | `8px` |
| Shadow | `0 4px 12px rgba(0, 0, 0, 0.15)` |
| z-index | `9999` |
| Position | bottom-right |
| Auto-dismiss | 3s (short), 5s (long) |
| Entrance | `translateX(100%)` → `translateX(0)`, 300ms |
| Easing | `cubic-bezier(0.23, 0.82, 0.16, 1.46)` |

### Toast Colors (Dark Mode)
| State | Background | Border | Text | Icon |
|---|---|---|---|---|
| Success | `#064e3b` | `#065f46` | `#a7f3d0` | `#10B981` |
| Error | `#450a0a` | `#991b1b` | `#fecaca` | `#EF4444` |
| Warning | `#451a03` | `#92400e` | `#fde68a` | `#F59E0B` |
| Info | `#1e3a5f` | `#1e40af` | `#bfdbfe` | `#38BDF8` |

---

## Mobile Design Specs

| Property | Value |
|---|---|
| Bottom nav height | `56px` (Android) / `49pt` + safe area (iOS) |
| Touch target min | `48x48px` |
| Card border radius | `12px` (more rounded for thumb) |
| Body font | `14-16px` |
| Headings | `18-20px` |
| Metadata | `12px` |
| Recommended tabs | Dashboard, Deals, Deliveries, Reports, More |

### Breakpoints
- Mobile: < 768px (single column, bottom nav)
- Tablet: 768-1024px (two columns, collapsible sidebar)
- Desktop: > 1024px (full layout, persistent sidebar)

---

## Notification Center Specs

| Property | Value |
|---|---|
| Dropdown width | `360px` |
| Max height | `360px` |
| Badge size | `18px` min-width |
| Badge color | `#EF4444` |
| Unread dot | `7px` diameter, `#10B981` |
| z-index | `9999` |
| Tabs | All / Unread / Archived |

---

## Cross-Platform Comparison

| Pattern | GoHighLevel | Monday.com | Pipedrive | DealerSocket | Reynolds |
|---|---|---|---|---|---|
| Nav | Icon sidebar + mega panels | Collapsible sidebar 244px | Icon sidebar (10 max) | Module tabs | Screen codes |
| Kanban | Configurable cards, drag-drop | Status-based, inline edit | 5+7 fields, rotting indicator | Stage-based | N/A |
| Font | Poppins | Figtree + Nunito Sans | System fonts | N/A | N/A |
| Body size | ~14-17px | 14px | 14px | N/A | N/A |
| Dark mode | Navy `#00142a` + purple | Yes + Night (3 modes) | Yes (subdued palette) | No | No |
| Brand color | Blue `#007ef5` | Purple `#6161FF` | Green `#017737` | Blue | Blue |
| Top complaint | Cluttered UI | Features paywalled | Bad support | Complex setup | Legacy feel |
