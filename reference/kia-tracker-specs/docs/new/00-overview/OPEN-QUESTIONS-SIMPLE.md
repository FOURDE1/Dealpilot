# Open Questions — Simple Version

Plain-language version of [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md). Same question numbers. **Good news (2026-07-23): almost everything below is now decided** — each question shows its answer with a ✅. The only things still open are the **client's 5 answers** (collected, ready to send, in [CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md)) and the **deferred legal review (Q-24)**, which must happen before the AI goes live to the public. The client's answers are deliberately deferred: each is needed only **just before its configuration is set up**, and building continues meanwhile.

---

## 💰 Money & Pricing

**Q-01. How much do dealerships pay per month?**
Suggested: 3 plans — **$300** (CRM only, no AI), **$500** (adds AI texting), **$800** (adds AI phone calls). 14-day free trial.
✅ **Decided (2026-07-23):** $300/$500/$800 approved. **Plus:** plans, prices, and what each plan includes must be fully manageable from the admin console — create, edit, and reprice plans, per-dealership overrides, grandfathering. Changing a price never requires a code change.

**Q-02. Do your own stores (Kia ML, ReadyCar, Riverside) pay?**
Suggested: **No** — they get a free internal plan, but usage is still tracked so billing is proven to work.
✅ **Decided (2026-07-23):** they never pay a subscription — they own the project (they paid for the build) and they cover the hosting costs. Usage is still fully tracked.

**Q-08. OK to spend about $650–$1,000/month on servers and services before the platform makes money?**
Suggested: **Yes**, with $1,000 as the ceiling, reviewed every 3 months. About $180–230 of this is the AWS hosting you chose in Q-11 (the cheaper US options would have been $40–80, but nothing would run in Canada).
✅ **Decided (2026-07-23) — with a condition:** approved in principle, but spending **ramps up**: keep costs minimal while building (smallest servers, free/dev tiers, scale-to-zero where possible). The full envelope only turns on at production launch, once the system demonstrably works and generates value. Not paying full from day one.
🔄 **Update (2026-07-24):** you moved the database from Supabase to **Amazon RDS** (Amazon's managed Postgres, still in Montreal). While building, nothing really changes (~$28–30/month for the database — about what Supabase cost). At production launch the database costs about $95–115/month more than before, so the full envelope becomes **about $750–$1,100/month**. The ramp-up condition stays exactly the same.

**Q-09. Buy a $299 (one-time) professional UI kit? Skip the $999/year data-grid license for now?**
Suggested: **Yes to both.**
✅ **Decided (2026-07-23) — changed:** **don't buy the $299 kit.** It's made for marketing/landing pages, and this product is a **system**, not a landing page. The interface stays fully professional with the free stack (Tailwind v4 + shadcn/ui), and the look — colors, style, overall design direction — is **chosen first with Google Stitch** (an AI design tool) and locked in before any screens are built. The $999/year data-grid license stays skipped for now.

**Q-24. Pay a Quebec lawyer (one fixed fee) to check the consent texts, AI disclosure wording, and bill-of-sale template before the AI goes live?**
Suggested: **Yes** — the fines for getting this wrong are huge (up to $10M+).
⏸ **Deferred (2026-07-23):** parked for now — but this is a **mandatory pre-launch task**. The lawyer review must be completed before the AI talks to the public, once the system is production-ready.

**Q-25. Create a separate company (e.g., "ReadyLoans Inc.") that owns the product, the Stripe account, and the domains — and your dealerships become its customers?**
Suggested: **Yes.** Also confirm you like the name "ReadyLoans".
🔶 **Partially decided (2026-07-23):** the working name stays **"ReadyLoans"**; the final product name is up to the client — see [CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q1. The product stays easy to rebrand.

---

## 📥 Leads & Integrations

**Q-03. Which lead sources do we connect first?**
Suggested order: 1) your website forms, 2) Facebook/Meta ads, 3) AutoTrader.ca, 4) Kijiji Autos, 5) CarGurus, 6) Kia Canada last.
**We also need from you:** which ad accounts each store uses, and roughly how many leads per month come from each source.
✅ **Decided (2026-07-23) — and expanded:** connect **all** of them, and build a generic connector framework so any new lead source can be added later with configuration only (webhooks, ADF email, API polling) — no new code per source. Lead volumes per source: waiting on the client ([CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q2).

**Q-12. Digital signatures: use OneSpan first, add DocuSign later only if a dealership asks?**
Suggested: **Yes.**
✅ **Decided (2026-07-23):** OneSpan.

**Q-13. Bill of sale: ReadyLoans creates the customer's copy, but Merlin/CAMS stay in place for government registration?**
Suggested: **Yes** — we don't replace Merlin/CAMS in version 1.
❓ **Waiting on the client:** the exact Merlin/CAMS role — see [CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q3. The suggested setup stands in the meantime.

**Q-14. Bank/lender submissions (DealerTrack, Credit Up): keep tracking them manually for now, build real API connections later?**
Suggested: **Yes.**
✅ **Decided (2026-07-23):** yes — manual tracking stays (it matches the client's demo DMS); real API connections come later as planned.

**Q-23. Reading VINs: use the free government decoder now, pay for a better one only if we need exact trim levels?**
Suggested: **Yes.**
✅ **Decided (2026-07-23) — changed:** maximum accuracy from day one. Use a **paid Canadian-aware VIN decoder** (e.g., DataOne), picked after a short accuracy test; the free government decoder is kept for development only.

---

## 📞 Phone & AI

**Q-04. Use Twilio for phone numbers, texting, and AI calls?**
Suggested: **Yes** — one vendor for everything.
✅ **Decided (2026-07-23):** Twilio.

**Q-05. One local phone number per store (819 for Kia ML, local codes for Ontario stores)?**
Suggested: **Yes.**
✅ **Decided (2026-07-23):** yes — one local number per store.

**Q-06. AI texting brain: use the best model (Claude Opus), with an automatic alert if one conversation costs more than $0.50?**
Suggested: **Yes** — a normal conversation should cost $0.10–$0.30.
✅ **Decided (2026-07-23) — changed:** don't lock in one model. Build a **model-agnostic AI layer** with a built-in testing harness that compares models (Claude Opus/Sonnet/Haiku and future ones) and picks the best quality-per-dollar for each job — swappable per store and per task without code changes. The $0.50 alert stays.

**Q-07. AI voice calls: plan around $0.15/minute, with a limit of 500 minutes per store per month (~$75)?**
Suggested: **Yes** — you get a warning at 80% and can raise the limit anytime.
✅ **Decided (2026-07-23):** yes — careful, logical limits: per-store and per-plan caps, a warning at 80%, and a graceful hand-off to a human when the cap is hit. Current numbers stand until real usage data tunes them.

---

## 🔄 Moving Your Data

**Q-10. Data migration — four small decisions:**
1. Move **all** deal history (not just recent)? Suggested: **yes**.
2. Switch over on a **weekend**, then run both systems side-by-side for one week? Suggested: **yes**.
3. The new system will recalculate commissions correctly and may reveal old over/under-payments — **who reviews that report?** Suggested: **you personally**.
4. Old system becomes **read-only** after the switch, retired later? Suggested: **yes**.

✅ **Decided (2026-07-23) — big change:** all the existing data is **test data**, so there is nothing to migrate. Production starts with a **clean, empty database**. No data migration, no side-by-side week, no commission report to review, no read-only period — the four questions above no longer apply. Pay plans and store settings are entered fresh when each store is onboarded; the old system stays around only as a reference for how the business rules work.

**Q-11. Where do the servers run? — ✅ Answered: AWS in Montreal.**
You decided: **AWS (ca-central-1, Montreal)**. That means **everything runs in Canada** — the app servers *and* the database (which was always in Canada). No customer data is stored or processed outside the country. It costs more than the cheaper US-based options ($180–230/month instead of $40–80 — already counted in Q-8), which you accepted for full Canadian residency and the credibility AWS carries with bigger clients. Nothing more needed from you here.
🔄 **Update (2026-07-24):** you also moved the database itself onto AWS — **Amazon RDS for PostgreSQL**, still in Montreal, locked inside the private network (nothing can reach it from the internet). Now every piece of the platform runs on one AWS account in Canada: one vendor, one region, one bill. Cost impact is counted in Q-8.

---

## 📋 Business Rules (say OK, or change the numbers)

**Q-15. Deal stages:** 10 stages; deals can move backward but a reason must be given; only managers can skip stages. **OK?**
✅ **Decided (2026-07-23):** OK as written. Each store can adjust later.

**Q-16. Delivery date is blocked until the checklist is done** — but a GM/owner can override, and the override is recorded. **OK?**
✅ **Decided (2026-07-23):** OK as written.

**Q-17. Automatic alerts:** car unsold **60 days** • safety inspection overdue **14 days** • funding stuck **7 days** • no photos within **48 hours** • recon cost over **$2,000** • deal stuck in one stage **7 days**. Each store can change these later. **OK?**
✅ **Decided (2026-07-23):** OK — keep these numbers; stores can change them later.

**Q-18. Commissions:** we re-confirm all 12 pay plans with you at migration; F&I managers get their own per-store plan; old payment mistakes are **not** corrected retroactively — only fixed going forward. **OK?**
✅ **Decided (2026-07-23):** OK — and since we now start with a clean database (Q-10), there are no old payments to worry about at all. Pay plans are entered fresh at onboarding.

**Q-19. Duplicate leads:** match by phone first, then email; flag them and merge by hand; **never** auto-delete — a returning lead is a hot lead. **OK?**
✅ **Decided (2026-07-23):** OK as written.

**Q-20. Delivery blockers:** insurance verified • void cheque received • funding funded • ID verification done • safety passed • wet-ink file ready.
**We need from you:** does this list differ between Ontario and Quebec stores, and which banks require ID verification (and on which platform)?
✅ **Decided (2026-07-23):** the list is OK. The Ontario-vs-Quebec differences and the ID-verification banks/platform: waiting on the client ([CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q4).

**Q-21. Vehicle photos:** 6 required angles, uploaded within 48 hours of arrival, the listing salesperson is responsible. **OK?**
✅ **Decided (2026-07-23):** OK as written.

**Q-22. Wholesale:** flag a car at 60 days in stock, GM or wholesale manager decides, sell on TradeRev + ACV first.
**We need from you:** who has wholesale authority in each store?
✅ **Decided (2026-07-23):** OK as written. Who holds wholesale authority in each store: waiting on the client ([CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q5).

---

## How to answer

**Update (2026-07-23): everything above is answered — nothing left for you to decide here.** What remains:

1. **The client's 5 answers** — collected, ready to send, in [CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md): final product name, lead volumes per source, Merlin/CAMS role, ON-vs-QC checklist + ID-verification banks, and wholesale authority holders. These are **deferred**: each answer is only needed just before its configuration is set up — building continues in the meantime.
2. **The legal review (Q-24)** — deferred for now, but **mandatory before the AI goes live to the public**.

If you ever want to change one of the decisions above, just say so (example: "Q17 → flag cars at 30 days instead of 60") and we'll update the docs.
