# Architecture Blueprint

## 1) Domain Modules

### A. Identity & Access
- Public visitor, Subscriber, Admin roles
- Authenticated route guard with real-time subscription status checks
- Authorization layer for admin-only actions

### B. Subscription & Billing
- Stripe products/prices for monthly/yearly plans
- Webhook-driven source of truth for status:
  - active
  - past_due
  - canceled
  - incomplete
- Access middleware evaluates effective subscription state on each request

### C. Charity Engine
- Charity directory, profile pages, featured charity support
- User charity choice at onboarding
- Charity contribution percentage (min 10%) with optional increase
- Independent donation flow (separate from subscription)

### D. Score Management
- Stableford score entry with date
- Validation range: 1–45
- Auto-retain only latest 5 scores per user
- Display sorted by most recent score date

### E. Draw & Reward Engine
- Monthly draw batch
- Draw modes:
  - Random
  - Algorithmic (weighted using score frequency)
- Result states:
  - simulated (preview)
  - published (official)
- Winner calculation by match tier (5/4/3)
- Jackpot rollover if no 5-match winner

### F. Verification & Payouts
- Winners upload score proof screenshots
- Admin approve/reject workflow
- Payment state machine: pending -> paid

### G. Reporting & Analytics
- Active subscribers
- Monthly pool totals and tier allocations
- Charity distribution totals
- Draw statistics and winner breakdown

---

## 2) Suggested Technical Architecture

- **Frontend (Next.js):**
  - Public marketing pages
  - Subscriber dashboard
  - Admin dashboard
- **API Layer:**
  - Route handlers grouped by module (`/api/subscription/*`, `/api/draws/*`, etc.)
- **Database:**
  - PostgreSQL with strict constraints and foreign keys
- **Job Layer:**
  - Scheduled monthly draw creation
  - Notification jobs for results and verification status updates
- **Integrations:**
  - Stripe webhooks
  - Email provider
  - Storage bucket for proof uploads

---

## 3) Non-Functional Requirements Strategy

### Performance
- SSR/ISR for public pages
- Pagination in admin tables
- Query indexing on hot paths (scores, subscriptions, draws)

### Security
- HTTPS only
- Signed upload URLs for proof images
- RLS for subscriber data boundaries
- Admin audit log for sensitive actions

### Scalability
- Country code + currency support in schema
- Team/corporate account extension points
- Draw config separated from execution records

