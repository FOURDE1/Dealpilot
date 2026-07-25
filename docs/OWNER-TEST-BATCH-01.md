# BATCH-01 Owner Test — F-04 Team & Assignment + F-05 Desking (one combined round, D-031)

Login: hassan-test@1dealer.ca / Test-Dealpilot-2026! at http://localhost:5173
(If the password fails, tell Hussein — a database reset may have removed the
seed account; one script restores it.)
Tip: you can switch the app to English with the EN toggle in the top bar —
all steps below give the English labels.

## Part A — Team (F-04)

1. Click "Team" in the left menu (on your phone: 4th tab in the bottom bar).
2. You should see yourself listed as Owner, status Active.
3. Under "Add a member": name "Marc Seller", email marc@groupehassan.test,
   keep "Salesperson" checked, click Add.
   → Marc appears in the roster immediately, status Active.
4. On Marc's row click "Edit roles", also check "BDC agent", Save.
   → his row now shows both roles.
5. Try adding the same email again → a clear message says an account already
   exists with this email (no crash).

## Part B — Lead assignment (F-04)

6. Go to Leads and open any lead (create one first if the list is empty).
7. In the "Assign" dropdown pick "Marc Seller" → "Changes saved." appears.
8. Back on the Leads list: the "Assigned to" column shows Marc Seller.
9. Tick the "My leads" checkbox → that lead disappears (it's Marc's, not
   yours). Untick → it comes back.

## Part C — Remove a member (F-04)

10. On Team, click "Remove" on Marc's row and confirm.
    → Marc disappears from the roster; you stay.
11. Back on the Leads list, the lead that was Marc's now shows
    "Former member" — it is NOT silently unassigned. Open it and reassign
    to yourself; check "My leads" now shows it.

## Part D — Desking worksheet (F-05)

12. Open a lead and click "Desk a deal" in the Deals box.
13. Enter (leave the rest at 0): province Quebec, sale price 35 000,
    vehicle cost 31 000, trade allowance 10 000, ACV 9 500, lien 3 000,
    rebate 2 000, fees 499 (taxable OFF), F&I price 2 500 / cost 1 500,
    rate 5.99, term 60.
    → The Results panel should show, live, without any button:
    GST $1,375.00 · QST $2,743.13 · total tax $4,118.13 ·
    amount financed $33,117.13 · monthly payment $640.09 ·
    front gross $4,000.00 · total gross $4,500.00.
14. Change any number (e.g. sale price) → totals update by themselves.
    Put it back.
15. Switch province to Ontario → the two tax lines become one HST line.
    Switch back to Quebec.
16. Toggle FR ↔ EN in the top bar → amounts flip between "35 000,00 $"
    and "$35,000.00" style.
17. Click "Save deal" → you land back on the lead and the deal is listed
    in the Deals box with its monthly payment.
18. Phone check: open the same worksheet on your phone — everything in one
    column, no sideways scrolling.

Report anything that looks off — numbers, wording (both languages), layout.
