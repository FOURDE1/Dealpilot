# What we need from you to switch on messaging and the AI assistant

Two accounts, both under YOUR company's name so you own them. One takes weeks
of carrier review (start it today); the other takes ten minutes.

**Rule for everything on this page: credentials go only into a password
manager share or directly into the server's `.env` file. Never into a chat,
an email body, or a text message.**

---

## A. Twilio + Canadian A2P/10DLC registration — START TODAY (weeks)

Texting Canadian customers from software legally requires carrier
registration. The review is measured in days-to-weeks and nothing shortens it.

1. **Create the account** at twilio.com/try-twilio with a company email, and
   upgrade it to paid right away — trial accounts cannot complete A2P
   registration.

2. **Buy one Canadian number** (Phone Numbers → Buy a Number → Canada,
   SMS-capable). One is enough to launch. ~$1–2/month.

3. **Register the Brand** (Messaging → Regulatory Compliance → A2P/10DLC).
   Have ready: legal business name, corporation number (NEQ in Québec),
   business address, industry, website, and a contact person.

4. **Register the Campaign** — the slow part. Enter:
   - Use case: **Customer Care / Mixed**
   - Description: *"Automotive dealership CRM — appointment reminders,
     replies to customer sales enquiries, and follow-ups to customers who
     contacted us."*
   - 2–5 sample messages, each showing the opt-out wording, e.g.:
     *"Bonjour {name}, c'est {dealer}. Votre essai routier est confirmé
     samedi 10 h. Répondez ARRÊT pour ne plus recevoir de messages."*
   - Opt-in description: *"Customers text us first or provide their number
     when enquiring about a vehicle; consent is recorded per CASL."*

5. **Link the purchased number to the approved campaign.**

6. **Hand over, securely:** `TWILIO_ACCOUNT_SID` (AC…), `TWILIO_AUTH_TOKEN`,
   and the phone number (+1…).

---

## B. Anthropic API key — 10 minutes

Turns on the assistant's automatic replies. Until then, every message is
still received and routed to your staff — nothing is lost, just answered by
people only.

1. Sign up at **console.anthropic.com** with a company email.
2. Billing → add a payment method and set a **monthly spend limit**
   (US$50–100 is plenty to start).
3. API Keys → **Create Key**, name it `dealpilot-production`.
4. Copy the key immediately — it is shown once and starts with `sk-ant-…`.
5. Hand it over through the same secure channel.

---

*Prepared 2026-08-19. The software side is complete for both — these are
configuration values, not development work.*
