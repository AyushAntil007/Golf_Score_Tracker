# Golf Charity Subscription Platform

This project is a runnable Node.js MVP for a subscription-led golf scoring, charity contribution, and monthly draw platform.

## What the backend now covers

- Signup/login with `subscriber` and `admin` roles
- Subscription activation and cancellation for `monthly` and `yearly` plans
- Charity selection with a minimum 10% contribution
- Independent charity donations
- Stableford score entry, edit, delete, and automatic rolling latest-5 retention
- Subscriber dashboard payload with subscription, charity, scores, draw participation, and winnings
- Draw simulation and publish flow with:
  - random mode
  - algorithmic mode based on score frequency
  - 3/4/5-match winner detection
  - prize pool snapshots
  - 5-match jackpot rollover
- Winner proof submission, admin verification, and payout state updates
- Admin charity, user, subscription, dashboard, and reporting endpoints

## Run locally

```bash
npm run dev
```

The app starts on `http://localhost:3000` and will move to the next port if 3000 is already busy.

## Data store

All application data is stored in `data/store.json`.

Key collections:
- `users`
- `sessions`
- `charities`
- `subscriptions`
- `scores`
- `draws`
- `drawEntries`
- `prizePoolSnapshots`
- `winners`
- `donations`
- `auditLogs`

## Main docs

- `docs/api-spec.md`
- `docs/architecture.md`
- `docs/database-schema.sql`
- `docs/mvp-delivery-plan.md`

## Important limitation

This MVP models payments and storage internally. Stripe checkout, Stripe webhooks, file upload infrastructure, email delivery, and deployment to Vercel/Supabase are still the next integration layer rather than part of the current local server.
