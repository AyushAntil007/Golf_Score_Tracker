# Golf Charity Subscription Platform

This repository contains an implementation-ready blueprint for building the **Golf Charity Subscription Platform** described in the Digital Heroes PRD (March 2026).

## What this repo gives you

- A production-minded system architecture
- A normalized relational database schema (PostgreSQL/Supabase)
- API contract suggestions for user/admin flows
- A practical 8-week delivery plan you can execute for assignment submission
- A test checklist mapped directly to PRD requirements

## Recommended Stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Next.js Route Handlers or NestJS
- **Database:** Supabase Postgres + Row Level Security
- **Auth:** Supabase Auth or NextAuth (email + OAuth optional)
- **Payments:** Stripe subscriptions (monthly/yearly)
- **Storage:** Supabase Storage (winner proof uploads)
- **Background jobs:** CRON + queue (e.g., BullMQ / Supabase scheduled functions)
- **Email:** Resend / Postmark / SendGrid
- **Deployment:** Vercel + Supabase

## Core Documents

- [`docs/architecture.md`](docs/architecture.md) — high-level architecture and module boundaries
- [`docs/database-schema.sql`](docs/database-schema.sql) — SQL schema + constraints for PRD logic
- [`docs/api-spec.md`](docs/api-spec.md) — endpoint plan for user/admin features
- [`docs/mvp-delivery-plan.md`](docs/mvp-delivery-plan.md) — execution roadmap for assignment delivery

## Build Order (MVP)

1. Auth + user profile + role system
2. Subscription model + Stripe webhook sync
3. Charity directory + signup selection
4. Score management (last 5 only, reverse chronological)
5. Draw simulation + publish + winner generation
6. Winner proof upload + admin verify + payout state
7. Dashboards (user + admin)
8. Analytics + polish + QA checklist

## Assignment Submission Tips

- Prioritize correctness of score rollover and draw logic over visual complexity.
- Show auditability: every draw and payout action should be traceable.
- Keep admin actions explicit and permission-gated.
- Ship a clear demo script and test credentials.

