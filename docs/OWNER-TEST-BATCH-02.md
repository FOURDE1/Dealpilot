# BATCH-02 Owner Test — F-06 Pipeline + F-07 Inventory + F-08 Delivery Checklist + F-09 Commissions

One combined round (D-031/D-032). Login: hassan-test@1dealer.ca /
Test-Dealpilot-2026! at http://localhost:5173 — EN toggle in the top bar; the
steps below use the English labels.

To start the stack: `pnpm dev` in the project root (API on 3001, app on 5173).
If the login fails, a database reset removed the seed account — say so and one
script restores it.

## Part A — The deal pipeline (F-06)

1. Click "Deals" in the left menu. You get a board with ten columns:
   New, Submitted, Approved, Signed, Sourcing, Pending delivery, Scheduled,
   Delivered, Complete, Lost.
2. Move one of your deals from New to Submitted (drag it, or use the stage
   buttons on the card).
   → It lands in the new column and stays there after a page refresh.
3. Notice the funding badge on the card — that is a SEPARATE track
   (not_submitted / submitted / approved / funded). A deal can be "Signed" in
   the pipeline while funding is still "Submitted". That is on purpose: they
   are two different real-world processes.
4. Try to move a deal straight from New to Complete → it is refused with a
   message naming the stages you have to pass through.

## Part B — Inventory (F-07)

5. Click "Inventory". Add a vehicle: stock number A-1001, VIN
   1HGCM82633A004352, 2021 Honda Accord, 48 000 km, cost 22 000, price 26 900.
   → It appears in the list with total cost.
6. Add a second vehicle with the SAME stock number → refused, and the message
   names the stock number specifically (not a database error).
7. Same again with a duplicate VIN → refused, message names the VIN.
8. Open a deal's worksheet and pick the Accord in the vehicle field
   → the vehicle cost fills in from inventory; the deal's numbers recalculate.

## Part C — The delivery checklist (F-08) — the point of this batch

9. Open a deal and find the "Delivery checklist" panel. Ten items, all unticked:
   Client insurance · Void cheque · Funding approved · Identity verification ·
   Safety inspection · Vehicle ready · Wet-ink file · Delivery date ·
   Drivers booked · Registration.
10. **Try to move that deal to "Delivered" now** → REFUSED, and the message
    lists what is still outstanding. This is the whole feature: "delivered"
    can no longer be a claim someone types.
11. Tick a few items (say insurance, void cheque, funding).
    → Each one is recorded with your name and the time.
12. On "Void cheque" click "Waive". Leave the reason blank → refused, it
    insists on a reason. Enter "Pre-authorized debit already on file" and save.
    → The item shows as waived, with your reason and your name against it.
    (This is what an auditor reads later.)
13. On **"Safety inspection"** try to waive it → REFUSED, no matter that you
    are the owner. A safety inspection is a legal obligation, so nobody in the
    system can wave it through — not you, not a GM.
14. Tick everything remaining, including safety.
    → The panel turns to "Ready for delivery".
15. Now move the deal to "Delivered" → it goes through, and the deal records
    its delivery date.
16. Go to Settings → your store → "Delivery checklist". Switch
    "Drivers booked" off (your store does not do that).
    → Try switching **Safety inspection** off too → refused, same reason as 13.
17. Open the deal from step 9 again → "Drivers booked" is STILL on it. Changing
    store policy today does not rewrite a deal that was already in flight. New
    deals from now on will not have it.

**A note on who can waive:** only an owner or GM can waive an item. If you want
to see this, log in as a salesperson later — their Waive button is refused by
the server, not just hidden.

## Part D — Commissions (F-09)

18. Go to Settings → Pay plans. Add a plan for Marc Seller: rate 25%, pad on,
    pad 1 500, tier on at 40 000 gross → 30%.
19. Open a deal, set "Sold by" to Marc, F&I reserve 500, and fund it
    (funding status → Funded).
20. Go to Commissions → Marc's line is there, showing: the deal's total gross,
    the gross the rate was applied to (**after** the 1 500 pad — check this
    number, it is the exact place the old system was wrong), the rate it used,
    and the dollars.
21. Fund the same deal again / reload → still ONE line. It cannot double-pay.
22. If you set yourself an override on Marc (Settings → Pay plans, "override
    on" Marc at 5%), fund another of his deals → you get your OWN line, paid
    from his deal. In the old system overrides silently never paid; here the
    line is written on your record, not his.

## Please report

Anything that looks off — a number, a French or English wording, a layout that
breaks on your phone. Especially in Part C step 13 and Part D step 20: those two
are the ones we built this batch for.

---

## KNOWN LIMITATION — inviting a brand-new person (D-035)

Adding a member creates their roster row, but **it does not yet send them a login**.
Someone added this way cannot sign in until we build the invitation flow. It needs a
decision from you first — see `docs/OWNER-DECISIONS-PENDING.md`, D-035.

So during testing: add members freely and check the roster, roles and assignment
behave — but don't expect to be able to log in *as* Marc yet. That is a known gap,
not something you broke.
