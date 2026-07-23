# Reliability & Cost

This document defines what ReadyLoans promises tenants (SLA), what we hold ourselves to internally (SLOs), how capacity is planned and autoscaled, how disaster recovery is tested, and what the platform costs to run at 1, 10, and 50 dealerships. It implements the reliability consequences of ADR-014 (AWS hosting), ADR-008 (database), ADR-010/012 (cache/queues), ADR-024 (billing/entitlements), and ADR-025 (SLOs). All content is **Target** — the legacy tracker has no SLA, no backup verification, no scaling story, and no cost model.

## Table of Contents

1. [SLA vs SLO](#1-sla-vs-slo)
2. [Error budgets and release policy](#2-error-budgets-and-release-policy)
3. [Capacity model](#3-capacity-model)
4. [Component headroom and scaling checkpoints](#4-component-headroom-and-scaling-checkpoints)
5. [Autoscaling and load shedding](#5-autoscaling-and-load-shedding)
6. [Failure modes and single points of failure](#6-failure-modes-and-single-points-of-failure)
7. [Backups and disaster recovery](#7-backups-and-disaster-recovery)
8. [DR drills](#8-dr-drills)
9. [Monthly cost model — 1 / 10 / 50 dealerships](#9-monthly-cost-model--1--10--50-dealerships)
10. [Cost controls](#10-cost-controls)

---

## 1. SLA vs SLO

**SLA** — the external, contractual commitment in tenant agreements. **SLO** — the stricter internal target (observability.md §7) that leaves margin so we breach our own target long before a tenant's contract.

| Commitment | Value | Measurement | Remedy |
|---|---|---|---|
| SLA: platform availability (Web + API + Intake) | **99.5% monthly** | Better Stack monitors, published on `status.readyloans.app` | Service credits: 10% of the monthly rooftop fee below 99.5%, 25% below 99.0% (credit, not refund; claims within 30 days) |
| SLA exclusions | Scheduled maintenance (announced ≥48 h, ≤4 h/mo), tenant DNS/domain misconfiguration, third-party carrier outages (Twilio/Resend delivery beyond handoff), force majeure | — | — |
| SLO: API availability | 99.9% | observability.md §7 | Internal error-budget policy (§2) |
| SLO: API p95 | < 300 ms | ADR-025 | — |
| SLO: intake ACK p99 | < 1 s | ADR-005/025 | — |
| SLO: AI first touch | < 60 s | ADR-022/025 | — |

The AI first-touch target is marketed ("your leads get an answer in under a minute") but is **not** an SLA-credited metric at launch — it depends on Anthropic/Twilio availability we don't control. Revisit once 6 months of attainment data exists.

Payment failure never becomes a reliability event for data: dunning leads to grace period → **read-only mode**, never deletion (ADR-024).

## 2. Error budgets and release policy

30-day rolling budgets from the 99.9% availability SLO: **43.2 minutes** of full unavailability, or the equivalent in partial degradation (weighted by affected-request fraction).

| Budget consumed | Policy |
|---|---|
| < 50% | Normal release cadence (continuous deploy, ci-cd.md) |
| 50–100% | Feature deploys require an extra reviewer; risky migrations (`migration:contract` label) postponed |
| > 100% (SLO breached) | Feature freeze: only reliability fixes deploy until the 30-day window recovers below 100%; incident review mandatory |

Budget accounting is reviewed in the weekly ops review with the burn-rate dashboards (observability.md §8).

## 3. Capacity model

### 3.1 Per-store assumptions (planning constants — revisit quarterly against real telemetry)

| Driver | Value / store / month | Source |
|---|---|---|
| Staff users | 15 (of the 10-role taxonomy) | Kia ML has 12 salespeople + managers |
| Leads | 450 (≈15/day) | Owner's 5-minute-SLA discussions; mid-size rooftop |
| AI SMS conversations | 315 (70% of leads engage) | Planning estimate |
| AI voice minutes | 300 | ADR-020 ConversationRelay pricing basis |
| SMS segments | 2,500 | ~8 segments per engaged conversation incl. STOP/consent turns |
| Deals created | 100 | Kia ML volume class |
| Inventory units photographed | 100 units × 6 angles = 600 origin images | ADR-013 (6 required angles) |
| Emails | 1,500 (transactional + reports) | — |
| Documents generated (PDF) | 400 | 13-document catalog × deal volume share |

### 3.2 Derived platform load

| Metric | 1 store | 10 stores | 50 stores |
|---|---|---|---|
| Peak API throughput (staff UI, 2 pm weekday) | ~3 req/s | ~25 req/s | ~120 req/s |
| Intake webhooks/day | ~15 | ~150 | ~750 |
| BullMQ jobs/day (all queues) | ~2,500 | ~25,000 | ~125,000 |
| `messages` rows/year (AI conversations) | ~110k | ~1.1M | ~5.5M |
| `activity_events` rows/year | ~250k | ~2.5M | ~12.5M |
| DB size (year 1, excl. media) | < 2 GB | ~10 GB | ~50 GB |
| Storage (vehicle media + documents) | ~2 GB | ~25 GB | ~120 GB |
| Realtime concurrent connections | ~20 | ~200 | ~1,000 |

Implications:

- Even the 50-store peak (~120 req/s) is a fraction of a single Fastify instance's ceiling (~60k req/s on JSON benchmarks); **the database is the bottleneck by design assumption** — hence the composite `(tenant_id, …)` index rule and covering indexes for the kanban query (ADR-008).
- `activity_events` crosses the ~10M-row partitioning threshold (ADR-008) around year 1 at 50 stores — schedule the monthly-partition migration at the 35-store mark, before it's urgent.
- Realtime at 1,000 concurrent connections is trivial for the Socket.IO layer (ADR-004, amended 2026-07-24) — long-lived sockets on the `api` tasks, with the `@socket.io/redis-adapter` on Valkey fanning events across tasks.

## 4. Component headroom and scaling checkpoints

| Component | Launch size | Comfortable ceiling | Scale checkpoint (act before) |
|---|---|---|---|
| `api` 2 × Fargate (0.5 vCPU/1 GB), 2 AZs | ~25 req/s sustained with DB headroom | ~200 req/s (with task count/size growth) | CPU > 60% sustained or p95 > 200 ms at steady state → add task / grow task size |
| `workers` 1 × Fargate (0.5 vCPU/1 GB) | ~15k jobs/day | ~150k jobs/day with scale-out + 1 vCPU/2 GB tasks (PDF/Chromium is the constraint) | Queue-wait SLO trending; PDF queue p95 > 60 s |
| `intake` 1 × Fargate (0.25 vCPU/0.5 GB) | 750 webhooks/day trivially | ~50 req/s burst | Add 2nd task at 10 stores (redundancy, not load) |
| ElastiCache Valkey `cache.t4g.micro` | BullMQ + cache + limits at pilot | `cache.t4g.medium` class covers 50 stores | Memory > 60% → next instance class (keys audit for TTL leaks first); replica + Multi-AZ before GA (ADR-014) |
| RDS PostgreSQL — Multi-AZ `db.t4g.medium` at launch (ADR-008) | Pilot + 10-store load with headroom | Next instance class (~50 stores) via maintenance-window resize | DB CPU > 50% sustained or p95 query > 100 ms on board queries (CloudWatch + Performance Insights) |
| RDS Proxy connections | 30 client connections (2×10 `api` + 1×5 `workers` + 5 `intake`) | Proxy multiplexes hundreds | Pool exhaustion warnings (observability.md §8) |
| Read replica | none | — | Add when reporting/exports contend with OLTP (ADR-008) — expected ~35–50 stores |

## 5. Autoscaling and load shedding

### 5.1 Scaling rules

| Service | Signal | Scale up | Scale down | Floor / ceiling |
|---|---|---|---|---|
| `api` | ECS target-tracking: CPU > 70% for 5 min, ALB requests-per-target above target, or p95 > 250 ms for 10 min | +1 task | CPU < 30% for 30 min | 2 / 6, spread across 2 AZs (ADR-014: ≥2 always-on) |
| `workers` | BullMQ queue-depth CloudWatch metric: `waiting > 500` on any queue, or oldest wait > 60 s | +1 task | All queues `waiting < 50` for 30 min | 1 / 8 |
| `intake` | p99 ACK > 500 ms for 5 min | +1 task | — | 1 / 3 (2 floor at ≥10 stores) |
| Valkey / Postgres | Vertical only (§4 checkpoints) | Maintenance-window resize | — | — |

Worker scaling is driven by a repeatable BullMQ job (`ops:scale-check`, every 60 s) that reads queue depths and publishes them as **custom CloudWatch metrics**; ECS target-tracking/step policies act on those metrics — queue depth is the truthful signal for consumer capacity, CPU is not (ADR-014). Per-tenant group limiters (ADR-012) already prevent one dealership's bulk import from consuming the added capacity.

### 5.2 Load-shedding order (overload playbook)

1. **Rate limits do their job** (ADR-011): per-tenant token buckets clamp noisy tenants; expensive endpoints (PDF/Excel export, AI call initiation, bulk import) hit their per-endpoint buckets first. `429 + Retry-After` is the designed behavior, not an incident. AWS WAF rate-based rules (ADR-014) clamp abusive sources before they reach the app.
2. **Deprioritize elastic queues**: pause `report-schedule`, `image` re-processing, and `drip` queues (BullMQ `queue.pause()`); email/SMS/AI-conversation and `webhook-delivery` stay live.
3. **Defer non-interactive AI work**: extraction/backfill jobs yield to first-touch jobs (queue priority already encodes this; the playbook only widens the gap).
4. **Never shed**: intake ACK, STOP processing, quiet-hours enforcement, auth. These are compliance/correctness paths (ADR-020/022).

## 6. Failure modes and single points of failure

| Component | Failure | Blast radius | Mitigation | RTO | RPO |
|---|---|---|---|---|---|
| One `api` task | Crash/bad node | None (≥2 tasks across 2 AZs behind the ALB, `/readyz` gating) | ECS replaces the task | 0 | 0 |
| All `api` tasks | Bad deploy | Full API outage | ECS deployment circuit breaker auto-rollback + canary watch (ci-cd.md §8) | < 15 min | 0 |
| `workers` | Crash mid-job | Delayed jobs only | Idempotent jobs + deterministic IDs re-run safely (ADR-012); ECS restarts the task | < 5 min | 0 (at-least-once) |
| ElastiCache Valkey (single node at pilot) | Node loss | Sessions re-established, cache cold, queued jobs since last snapshot lost, rate limits reset | ElastiCache automatic snapshots + managed node replacement; replay lead intake from the intake request log (every inbound webhook persisted before ACK); replica + Multi-AZ automatic failover before GA (ADR-014) | < 30 min | Queued jobs since last snapshot — recoverable via intake replay; correctness never depends on Valkey (ADR-010) |
| One AZ (of two) | AZ outage | `api` keeps serving from the surviving AZ (ALB + tasks span 2 AZs); RDS Multi-AZ fails over to its standby, and DB traffic stays in-VPC (no NAT dependency). The single pilot NAT lives in one AZ: if that AZ is lost, private-subnet egress to external providers fails until the NAT is recreated in the surviving AZ via IaC — accepted pilot risk (ADR-014); second NAT before GA | Multi-AZ ALB/tasks + RDS standby; IaC NAT re-create runbook | < 30 min | 0 |
| RDS PostgreSQL (Multi-AZ) | Instance/AZ failure | Full outage during failover | RDS Multi-AZ automatic failover to the standby (typically 1–2 min); PITR | Minutes (automatic) | ~0 |
| AWS `ca-central-1` region (takes the database too — single-vendor AWS) | Region-wide outage | Full outage | §7 region-loss procedure | ≤ 8 h | ≤ 24 h (nightly offsite dump) — accepted at launch; re-evaluate at 25 stores |
| CloudFront / S3 (SPA edge) | CDN/edge outage | Web down, API up (ALB path is independent) | Rare/global; accept. Status page (Better Stack-hosted) stays up | provider | 0 |
| Twilio / Resend / Anthropic | Provider outage | Channel-specific degradation | BullMQ retries with backoff absorb blips; > 30 min → status-page component "degraded"; Telnyx is the documented voice alternate (ADR-020) | provider | 0 (jobs persist and retry) |
| AWS KMS | Unavailable | Cannot decrypt PII fields (reads of SIN/licence fail); rest of app unaffected | KMS SLA is 99.999%; decrypt paths degrade gracefully with field-level error states | provider | 0 |
| Stripe | Outage | Billing events delayed | Webhook retries (Stripe-side); entitlements cached on tenant record keep working (ADR-024) | provider | 0 |

## 7. Backups and disaster recovery

| Data | Mechanism | Frequency | Retention | RPO |
|---|---|---|---|---|
| Postgres (prod) | RDS automated backups + **PITR** (continuous WAL archiving, KMS-encrypted — ADR-008) | Continuous (5-min log granularity) | **14 days** PITR window (`migrations-operations.md` §4; nightly logical dumps below are the snapshot layer) | ≤ 5 min committed |
| Postgres offsite | Logical dump (`pg_dump`) by a nightly worker job → versioned object storage **outside the platform accounts** (S3 `ca-central-1`, separate backup AWS account, object lock) | Nightly 03:00 ET | 30 daily + 12 monthly | ≤ 24 h (region-loss scenario only) |
| S3 bucket (`documents`) | Nightly cross-account sync to the same offsite S3 (documents are immutable snapshots with hashes — ADR-021 — so sync is append-only) | Nightly | 90 days versions | ≤ 24 h |
| S3 bucket (`vehicle-media`) | Not replicated at launch (re-uploadable, low criticality); replicate from 25 stores | — | — | accepted |
| Valkey (ElastiCache) | Automatic snapshots; queue durability is the **intake request log** (every inbound webhook persisted before ACK), not Valkey persistence | Daily snapshot | n/a (cache/queues) | Queued jobs since last snapshot — recoverable via intake replay; correctness never depends on it (ADR-010) |
| Container images | ECR with **cross-region replication** of release images | Per release | Per lifecycle policy | 0 |
| Config/infra | Everything as code: migrations in `packages/db`, **Terraform/CDK IaC in the monorepo (CI-applied, ADR-014)**, secrets inventoried (names, not values) in `docs/new/07-infrastructure/secrets-inventory.md` | Per PR | git history | 0 |

**Region-loss procedure (AWS `ca-central-1` catastrophic — takes platform compute *and* the database; single-vendor AWS):** IaC-apply the platform stack to the evacuation region (`ca-west-1`, Calgary — preserves Canadian residency), pulling images from the ECR cross-region replica by digest; provision a fresh RDS instance in the evacuation VPC and restore the latest offsite dump into it, replay what the intake request log and Stripe/Twilio/Resend delivery logs can reconstruct for the gap window; repoint `DATABASE_URL` and provider secrets via Secrets Manager + ECS redeploy; cut DNS over in Route 53; force tenant re-auth (sessions are DB-backed). Documented as runbook `runbooks/region-loss.md`; rehearsed per §8.

**Region evacuation procedure (compute-only scenarios — `ca-central-1` ECS/networking degraded while RDS remains healthy):** Terraform/CDK apply of the compute stack (VPC, ALB, ECS services, ElastiCache) in `ca-west-1`, images from the ECR replica by digest, inter-region VPC peering brought up by the evacuation stack so the evacuated compute can reach the VPC-private database, secrets restored from the Secrets Manager replica (1Password-vaulted break-glass set as fallback), Route 53 cutover (`api.` and `in.` records, 300 s TTL); the SPA needs no evacuation (CloudFront is global; the S3 origin is re-deployed from CI if needed). Runbook `runbooks/region-evacuation.md`.

## 8. DR drills

Drills are scheduled, owned, and pass/fail — a drill that can't fail is theater.

| Drill | Cadence | Procedure | Pass criteria |
|---|---|---|---|
| Backup restore verification | **Nightly, automated** (`nightly.yml`, ci-cd.md §10) | Restore last offsite dump into a scratch database; run integrity suite | Row counts per tenant within expected delta; latest `activity_events` timestamp < 26 h old; RLS suite green on restored DB |
| PITR restore drill | **Quarterly** | Restore prod PITR to a point 1 h in the past into a fresh staging-side project; run integrity suite + app smoke against it | Complete within RTO 4 h, measured and logged |
| DLQ replay drill | **Monthly** | Intentionally poison a staging job → verify DLQ alert fires (observability.md §8) → replay via the DLQ worker | Alert < 5 min; replay idempotent (no duplicate email/SMS side effects) |
| Region evacuation | **Semi-annual** | Execute `region-evacuation.md` for staging: IaC-apply the staging compute stack in `ca-west-1` (Calgary), cut staging DNS in Route 53, run smoke | Staging serving from `ca-west-1` within 4 h |
| Region-loss tabletop | **Semi-annual** (alternating with evacuation) | Walk `region-loss.md` end-to-end with the on-call rotation; time each step on paper | Gaps filed as issues within 48 h |
| Secret rotation drill | **Semi-annual** | Rotate one production credential class (DB password, Valkey AUTH token, or a provider key) via the documented procedure (Secrets Manager version staging) | Zero downtime; old credential confirmed dead |
| Full game day | **Annual** | Combined scenario (e.g., Valkey loss during deploy) in staging with the whole team | Incident process followed: roles, status-page comms in FR+EN, post-mortem within 5 days |

Drill results are recorded in `docs/new/07-infrastructure/drill-log.md` (date, scenario, timings, pass/fail, follow-ups). Missing two consecutive drills of any type is itself a P2 finding in the weekly ops review.

## 9. Monthly cost model — 1 / 10 / 50 dealerships

Estimates in USD/month; AWS lines at verified 2026 `ca-central-1` rates, 730 hr/mo (Fargate x86 $0.04456/vCPU-hr + $0.004865/GB-hr; ALB ~$0.0247/hr + $0.008/LCU-hr; NAT $0.05/hr + $0.05/GB processed; WAF $5/ACL + $1/rule-group + $0.60/M req; CloudFront free tier 1 TB + 10M req/mo; RDS `db.t4g.medium` Multi-AZ $0.1410/hr, `db.t4g.small` Single-AZ $0.0350/hr, gp3 $0.127/GB-mo Single-AZ / $0.254 Multi-AZ, RDS Proxy $0.016/vCPU-hr, backup storage $0.105/GB-mo beyond the free provisioned-size allowance — ADR-008, amended 2026-07-24); other lines at mid-2026 list prices (re-verify at purchase); scenario assumptions from §3.1. "1 store" is the Kia Mont-Laurier pilot (ADR-026). Fargate lines are priced x86; **ARM64/Graviton images (~20% cheaper, preferred per ADR-014) bring the pilot AWS subtotal to ~$175** — the pilot budget line is **US$180–230/mo** for the AWS platform.

**Cost ramp (decided 2026-07-23):** the table below is the **production run-rate from launch onward**, not a build-phase commitment. During the build phase, infrastructure spend is held to a minimum: smallest/singleton Fargate tasks (or none — development runs locally), **local Docker Postgres for dev ($0) plus a `db.t4g.small` Single-AZ staging RDS instance at ~US$28–30/mo incl. 20 GB gp3 — no RDS Proxy, no Multi-AZ pre-launch (ADR-008, amended 2026-07-24)**, no Valkey replica/Multi-AZ, WAF and the second NAT deferred to pre-launch hardening, and scale-to-zero wherever the platform allows (staging schedules, preview environments). The owner-approved full envelope (**~US$750–1,100/mo** all-in — restated 2026-07-24 with the RDS move, ADR-014) engages only from production launch.

| Line item | Basis | 1 store | 10 stores | 50 stores |
|---|---|---:|---:|---:|
| Fargate — `api` | 2 × 0.5 vCPU/1 GB → 2 × 1 vCPU/2 GB → 4 × 1 vCPU/2 GB | 40 | 80 | 160 |
| Fargate — `workers` | 1 × 0.5 vCPU/1 GB → 2× → 4 × 1 vCPU/2 GB (queue-depth scaled, §5.1) | 20 | 40 | 160 |
| Fargate — `intake` | 1 × 0.25 vCPU/0.5 GB → 2× (redundancy at ≥10 stores) | 10 | 20 | 20 |
| ALB | Base + ~1 → ~2 → ~5 LCUs | 24 | 30 | 45 |
| NAT gateway | 1 × $0.05/hr + ~50 → ~200 GB processed; 2nd NAT (per-AZ) by GA | 39 | 47 | 125 |
| ElastiCache for Valkey | `cache.t4g.micro` → `t4g.small` ×2 (replica/Multi-AZ) → `t4g.medium` ×2 | 13 | 50 | 100 |
| S3 + CloudFront (SPA) | Mostly inside the 1 TB/10M-req free tier at pilot | 2 | 10 | 40 |
| AWS WAF | 2 web ACLs (CloudFront + ALB) + managed rule groups + request volume | 25 | 30 | 40 |
| Route 53 | Hosted zone + queries | 2 | 5 | 10 |
| Secrets Manager | ~15 secrets → more per env/tenant integrations | 7 | 8 | 10 |
| ECR + CloudWatch | Image storage + logs/metrics/alarms | 10 | 20 | 50 |
| **AWS compute/network subtotal** | (~$175 at pilot on ARM64/Graviton) | **≈ 192** | **≈ 340** | **≈ 760** |
| RDS for PostgreSQL 16 | Multi-AZ `db.t4g.medium` $0.1410/hr from launch → next instance class at the §4 checkpoint (≈2× per class step — re-verify at resize) | 103 | 103 | 206 |
| RDS Proxy | $0.016/vCPU-hr × 2 vCPUs (t4g classes; no 8-vCPU minimum on provisioned instances) | 23 | 23 | 23 |
| RDS storage + backups | gp3 Multi-AZ $0.254/GB-mo (50 → 100+ GB provisioned) + backup overage $0.105/GB-mo beyond the free allowance | 15 | 20 | 30 |
| S3 tenant files + CloudFront (media) | §3.2 volumes (~2 → 25 → 120 GB) incl. pre-generated WebP/AVIF variants (sharp in workers — ADR-013, amended 2026-07-24); requests mostly inside free tiers | 1 | 3 | 10 |
| Resend | Pro $20 → Scale $90 | 20 | 20 | 90 |
| Twilio — phone numbers | $1.15/store local number | 1 | 12 | 58 |
| Twilio — SMS | 2,500 seg/store × ~$0.0105 (incl. carrier fees) | 26 | 260 | 1,300 |
| Twilio — voice + ConversationRelay | 300 min/store × ($0.07 CR + ~$0.014 PSTN) (ADR-020) | 25 | 252 | 1,260 |
| Anthropic Claude API | Opus 4.8 conversations + Haiku 4.5 extraction, per-tenant prompt caching (~90% input savings, ADR-022); ≈$120/store modeled | 120 | 1,200 | 6,000 |
| AWS KMS | 1 CMK + per-tenant data-key requests | 2 | 3 | 6 |
| Sentry | Team plan + event volume | 26 | 31 | 80 |
| PostHog EU | Free tier → usage-based | 0 | 50 | 300 |
| Better Stack | Uptime + logs + status page | 29 | 34 | 79 |
| GitHub Team | $4/user × 4 → 6 → 10 | 16 | 24 | 40 |
| Domains, misc | `readyloans.app` + tooling | 5 | 10 | 25 |
| **Total infrastructure** | | **≈ $605** | **≈ $2,385** | **≈ $10,260** |
| **Cost per rooftop** | | $605 | $239 | $205 |

**Database line vs the replaced Supabase line (ADR-008, amended 2026-07-24):** the previously documented Supabase line ran ~US$25–75/mo. The RDS move is **build-phase neutral** (the ~US$28–30 staging line sits inside the old range) and **+~US$95–115/mo at production launch** (the ~US$140–170 all-in DB line: instance ~$103 + proxy ~$23 + storage/backups ~$13–30). Documented cheaper option: a **Multi-AZ `db.t4g.small`** production line lands at **~US$90/mo** if pre-launch load testing shows it holds the pilot workload. The production envelope is restated at **~US$750–1,100/mo** accordingly (ADR-014).

Not in the table: **Stripe fees** (~2.9% + 30¢ of revenue — a revenue deduction, not infrastructure) and staff time. There are currently no one-time UI license purchases: Tailwind Plus was decided against (2026-07-23) and AG Grid Enterprise stays deferred (ADR-017).

**Honest comparison (ADR-014):** the Railway/Fly.io topology this decision replaced would have run the pilot's platform compute at **~US$40–80/mo** — AWS is **~3–4× that, plus real ops effort** (VPC/IAM/task definitions/IaC are now our code). The premium is deliberate: full Canadian compute+data residency (closes Q-11; Law 25 cross-border transfer for the core platform = none) and the enterprise credibility dealer-group and OEM procurement expects. Railway and Fly.io remain documented only as rejected alternatives.

**Margin sanity check vs ADR-024 pricing ($300–$800/rooftop/mo):**

| | 1 store (pilot) | 10 stores | 50 stores |
|---|---:|---:|---:|
| Revenue @ $550 avg | $550 | $5,500 | $27,500 |
| Infra cost | $605 | $2,385 | $10,260 |
| Gross margin | −10% | 57% | 63% |

Three structural facts: (1) **AI + telecom is 28% of cost at 1 store and 84% at 50** — it scales linearly with usage, which is exactly why ADR-024 meters AI minutes/SMS/conversations: overage passes through to the tenant instead of eroding margin; (2) fixed platform cost (~$490/mo, dominated by the ~$192 AWS compute baseline plus the ~$141 Multi-AZ RDS + Proxy line) amortizes to noise past 10 stores; (3) the pilot store running slightly below break-even (−10% margin) is acceptable — it is Hassan's own rooftop and the reference tenant, and the AWS residency + single-vendor premium (incl. the RDS delta, ADR-008) is the owner-accepted cost of closing Q-11 (ADR-014).

## 10. Cost controls

| Control | Mechanism | Owner check |
|---|---|---|
| AI input cost | Per-tenant prompt caching on the frozen prefix (~90% input savings — ADR-022); Haiku 4.5 for all extraction (never Opus); max-turn caps per conversation | Monthly: cost per conversation from Anthropic usage API vs Stripe Meters |
| AI/SMS overage | Stripe Meters bill usage beyond plan quota (ADR-024); rate limits read the same entitlements (ADR-011) — a tenant cannot consume unmetered AI | Drift alarm >5% between PostHog counts and Stripe Meters (observability.md §9) |
| Image variants | sharp pre-generates the WebP/AVIF `srcset` set once per origin image in workers (ADR-013, amended 2026-07-24) — serving is commodity S3 + CloudFront; EXIF-stripped, size-capped uploads; Cloudflare Images stays the documented fallback for on-the-fly transforms | S3 storage + CloudFront usage in the monthly review |
| Database | Staging stays Single-AZ `db.t4g.small`; Multi-AZ + RDS Proxy engage at launch only; documented cheaper option Multi-AZ `db.t4g.small` (~US$90/mo DB line) if load testing permits (ADR-008) | Performance Insights + CloudWatch DB metrics in weekly ops review |
| Valkey memory | `removeOnComplete/Fail` TTLs on every queue (ADR-012); tenant-prefixed key audit in the nightly job | Memory alert at 60% (§4) |
| NAT data processing | Free S3 gateway endpoint keeps S3/backup/SPA-deploy traffic off the NAT; ECR/CloudWatch/Secrets interface endpoints added only when NAT GB charges exceed endpoint cost (ADR-014) | NAT GB-processed trend in weekly ops review |
| Log volume | `info` level in prod, no request bodies, 30-day retention (Better Stack + CloudWatch log-group retention policies) | Better Stack ingest + CloudWatch trend in weekly ops review |
| Sentry volume | 10% trace sampling, client-side `ignoreErrors` for known noise, per-project rate limits | Quota alerts at 80% |
| PostHog volume | Server-side events for high-volume signals (no autocapture on data grids); replay sampled at 25% of consented sessions past 10 stores | Usage-based bill review monthly |
| Compute | Scale-down rules (§5.1) are as mandatory as scale-up; staging runs one size smaller everywhere; ARM64/Graviton images (~20% cheaper than x86 Fargate) preferred (ADR-014) | AWS Budgets alert at 120% of last month + Cost Anomaly Detection |
| Build-phase ramp | Pre-launch environments stay minimal (§9 cost ramp, decided 2026-07-23; DB line amended 2026-07-24): smallest tasks, local dev Postgres + Single-AZ staging RDS, Multi-AZ/RDS Proxy/WAF deferred, scale-to-zero where possible; the full production envelope engages only at launch | Build-phase AWS Budgets cap reviewed monthly |
| Review cadence | Full cost-model refresh against actuals **quarterly**; unit-price re-verification (this table's basis column) at each pricing checkpoint | Quarterly ops review, logged in `drill-log.md` |
