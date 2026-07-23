# ReadyLoans Platform Documentation

This documentation suite specifies the evolution of the Kia Mont-Laurier Deal Tracker — a single-dealership CRM/DMS built on React 18 + Vite, Express.js, and Supabase Postgres — into **ReadyLoans**, a production-grade, multi-tenant, white-label dealership platform with an AI lead-automation layer (webhook lead intake, AI chat and voice agents, intelligent routing to the best dealership and agent). It covers the current system's business logic, the target product requirements, architecture, security, database design, technology stack, infrastructure, AI automation, and platform administration — with French-first (Quebec Bill 96) compliance woven throughout.

## 00-overview

| Document | Description |
| --- | --- |
| [Executive Summary](00-overview/EXECUTIVE-SUMMARY.md) | High-level summary of the ReadyLoans vision, current state, and transformation plan. |
| [Architecture Decisions](00-overview/ARCHITECTURE-DECISIONS.md) | Key architectural decision records and the rationale behind each choice. |
| [Roadmap](00-overview/ROADMAP.md) | Phased delivery roadmap from single-dealership tracker to multi-tenant platform. |
| [Open Questions](00-overview/OPEN-QUESTIONS.md) | Unresolved decisions and questions requiring stakeholder input. |
| [Open Questions — Simple](00-overview/OPEN-QUESTIONS-SIMPLE.md) | Plain-language version of the open questions, ready to answer in one reply. |
| [Client Questions](00-overview/CLIENT-QUESTIONS.md) | Five ready-to-send questions for the client — the only remaining inputs. |

## 01-business-logic

| Document | Description |
| --- | --- |
| [Leads](01-business-logic/leads.md) | Lead capture, qualification, statuses, and lifecycle rules. |
| [Contacts](01-business-logic/contacts.md) | Customer and contact management, deduplication, and data model. |
| [Deals Pipeline](01-business-logic/deals-pipeline.md) | Deal stages, transitions, and pipeline management rules. |
| [Desking & Finance](01-business-logic/desking-finance.md) | Deal structuring, payment calculations, and finance workflows. |
| [Lenders & Bill of Sale](01-business-logic/lenders-billofsale.md) | Lender submissions, approvals, and bill-of-sale generation. |
| [Inventory](01-business-logic/inventory.md) | Vehicle inventory management, statuses, and valuation. |
| [Sourcing & Suppliers](01-business-logic/sourcing-suppliers.md) | Vehicle sourcing workflows and supplier management. |
| [Garage & Work Orders](01-business-logic/garage-work-orders.md) | Reconditioning, service work orders, and garage operations. |
| [Dispatch & Transport](01-business-logic/dispatch-transport.md) | Vehicle transport, dispatch scheduling, and logistics. |
| [Delivery](01-business-logic/delivery.md) | Vehicle delivery scheduling, checklists, and handoff. |
| [Documents](01-business-logic/documents.md) | Document generation, storage, e-signature, and PDF workflows. |
| [Appointments, Tasks & Communications](01-business-logic/appointments-tasks-communications.md) | Scheduling, task management, and customer communication tracking. |
| [Automation & Notifications](01-business-logic/automation-notifications.md) | Automated workflows, triggers, and notification rules. |
| [Commissions & Clawbacks](01-business-logic/commissions-clawbacks.md) | Sales commission calculation, payout, and clawback rules. |
| [Expenses & Accounting](01-business-logic/expenses-accounting.md) | Expense tracking, cost accounting, and financial reconciliation. |
| [Reports & Analytics](01-business-logic/reports-analytics.md) | Operational reporting, KPIs, and export capabilities. |
| [Platform Admin & Domains](01-business-logic/platform-admin-domains.md) | Platform-level administration and custom domain logic. |

## 02-product-requirements

| Document | Description |
| --- | --- |
| [Vision & Goals](02-product-requirements/vision-and-goals.md) | Product vision, target market, and success criteria for ReadyLoans. |
| [Functional Requirements](02-product-requirements/functional-requirements.md) | Detailed functional requirements for the multi-tenant platform. |
| [Non-Functional Requirements](02-product-requirements/non-functional-requirements.md) | Performance, availability, compliance, and quality requirements. |
| [Gap Analysis](02-product-requirements/gap-analysis.md) | Gaps between the current Kia tracker and the target ReadyLoans platform. |

## 03-architecture

| Document | Description |
| --- | --- |
| [System Architecture](03-architecture/system-architecture.md) | Overall system design, components, and service boundaries. |
| [Multi-Tenancy](03-architecture/multi-tenancy.md) | Tenant isolation model, tenant resolution, and data partitioning strategy. |
| [API Design](03-architecture/api-design.md) | API conventions, versioning, endpoint design, and contracts. |
| [Scalability & Performance](03-architecture/scalability-performance.md) | Scaling strategy, caching, and performance targets. |

## 04-security

| Document | Description |
| --- | --- |
| [Authentication & Authorization](04-security/authentication-authorization.md) | Identity, sessions, roles, and permission model across tenants. |
| [API Security](04-security/api-security.md) | API hardening: rate limiting, input validation, and webhook security. |
| [Data Protection](04-security/data-protection.md) | Encryption, PII handling, and privacy compliance (Law 25 / PIPEDA). |
| [Security Operations](04-security/security-operations.md) | Audit logging, incident response, and ongoing security practices. |

## 05-database

| Document | Description |
| --- | --- |
| [Database Architecture](05-database/database-architecture.md) | Overall database topology, tenancy model, and Amazon RDS for PostgreSQL strategy. |
| [Schema Design](05-database/schema-design.md) | Table designs, relationships, and data modeling conventions. |
| [Indexing & RLS](05-database/indexing-and-rls.md) | Index strategy and row-level security policies for tenant isolation. |
| [Migrations & Operations](05-database/migrations-operations.md) | Migration workflow, backups, and database operational procedures. |

## 06-tech-stack

| Document | Description |
| --- | --- |
| [Frontend Stack](06-tech-stack/frontend-stack.md) | React 18, Vite, Tailwind, and react-query architecture and conventions. |
| [Backend Stack](06-tech-stack/backend-stack.md) | Express.js server architecture, services, and integrations. |
| [UI Design System](06-tech-stack/ui-design-system.md) | Component library, theming, and white-label design tokens. |
| [Media, i18n & Validation](06-tech-stack/media-i18n-validation.md) | File/media handling, EN/FR internationalization, and validation strategy. |

## 07-infrastructure

| Document | Description |
| --- | --- |
| [Hosting Topology](07-infrastructure/hosting-topology.md) | Environments, hosting providers, and network topology. |
| [CI/CD](07-infrastructure/ci-cd.md) | Build, test, and deployment pipelines. |
| [Observability](07-infrastructure/observability.md) | Logging, metrics, tracing, and alerting. |
| [Reliability & Cost](07-infrastructure/reliability-and-cost.md) | Availability targets, disaster recovery, and cost management. |

## 08-ai-automation

| Document | Description |
| --- | --- |
| [Overview](08-ai-automation/overview.md) | AI lead-automation layer: goals, architecture, and lead intake flow. |
| [Conversation Engine](08-ai-automation/conversation-engine.md) | AI chat agent design: prompts, state, and information capture. |
| [Voice Agent](08-ai-automation/voice-agent.md) | AI voice call agent: telephony, speech, and call handling. |
| [Routing Engine](08-ai-automation/routing-engine.md) | Lead routing to the best dealership and best available agent. |
| [Compliance & Quality](08-ai-automation/compliance-and-quality.md) | AI guardrails, consent, bilingual compliance, and quality monitoring. |

## 09-admin-whitelabel

| Document | Description |
| --- | --- |
| [Admin Console](09-admin-whitelabel/admin-console.md) | Platform admin console for managing tenants, users, and configuration. |
| [White-Labeling](09-admin-whitelabel/white-labeling.md) | Per-tenant branding, theming, and custom domain white-labeling. |
| [Localization & Legal](09-admin-whitelabel/localization-and-legal.md) | French-first localization (Bill 96) and legal/compliance requirements. |
| [Analytics & Adoption](09-admin-whitelabel/analytics-and-adoption.md) | Platform-level analytics, tenant adoption metrics, and reporting. |
