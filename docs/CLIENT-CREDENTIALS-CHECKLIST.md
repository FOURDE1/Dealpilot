# What we need from you to switch on messaging and the AI assistant

Two accounts, both under YOUR company's name so you own them. About 30
minutes total.

**Rule for everything on this page: credentials go only into a password
manager share or directly into the server's `.env` file. Never into a chat,
an email body, or a text message.**

---

## A. Twilio (texting) — ~20 minutes

1. **Create the account** at twilio.com/try-twilio with a company email and
   upgrade it to paid (trial accounts can only text verified numbers).
2. **Buy one Canadian number** (Phone Numbers → Buy a Number → Canada,
   SMS-capable). One is enough to launch. ~$1–2/month.
3. **Hand over, securely:** `TWILIO_ACCOUNT_SID` (AC…), `TWILIO_AUTH_TOKEN`,
   and the phone number (+1…).

**Texting Canadian customers requires no carrier registration.** The
A2P/10DLC registration you may read about is a **US-carrier** requirement:
it applies only to texts sent TO US phone numbers. If you later want to text
US customers, we register then (business name, NEQ, address, website — takes
days to weeks to approve) — it blocks nothing today. Consent (CASL) is
handled inside the product.

---

## B. Anthropic API key — 10 minutes

Turns on the assistant's automatic replies. Until then, every message is
still received and routed to your staff — nothing is lost, just answered by
people only.

1. Create an account at **console.anthropic.com** with a company email.
2. Add a payment method (usage-based; light usage is a few dollars).
3. Create ONE API key and hand it over the same secure way.

---

## C. Later — not urgent, but yours to own (10–30 minutes each)

None of these block the current build. They become needed at launch, and each
account should be created under YOUR company so you own it from day one.

1. **A domain name** for the product (e.g. app.yourcompany.ca) — needed for
   the public website address, email sending, and SSL. Any registrar works.
2. **Stripe** (stripe.com) — how dealerships will pay you. Create the
   account and complete business verification; we wire it in later.
3. **Monitoring accounts** (free tiers): Sentry (error alerts), PostHog EU
   (product analytics), Better Stack (logs). Ten minutes each; hand me an
   invite to each workspace.
4. **AWS budget go-ahead** — the account exists already; hosting costs stay
   near zero until launch. When we schedule the launch, the production
   envelope is roughly $750–1,100/month and I will ask you before anything
   starts billing.
5. **US texting (optional):** the A2P/10DLC registration from section A, only
   if you want to text US numbers.

## The one-line summary

| What | Urgency | Time | Blocks |
| ---- | ------- | ---- | ------ |
| Twilio account + Canadian number | this week | ~20 minutes | texting features |
| Anthropic API key | this week | 10 minutes | the AI assistant |
| Domain, Stripe, monitoring | before launch | ~1 hour total | launch polish |
| AWS budget go-ahead | at launch scheduling | a yes | deployment |
| A2P/10DLC (US texting) | only if texting US numbers | days–weeks review | US recipients only |
