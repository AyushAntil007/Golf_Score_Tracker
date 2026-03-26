# Golf Charity Subscription Platform

This project is a runnable Node.js MVP for a subscription-led golf scoring, charity contribution, and monthly draw platform.


```bash
npm run dev
open: `http://localhost:3000` 
```

The app starts on `http://localhost:3000` and will move to the next port if 3000 is already busy.

## Supabase setup

1. Create a `.env` file based on `.env.example`.
2. Add your Supabase project values for:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. In the Supabase SQL editor, run [docs/supabase-state-schema.sql](docs/supabase-state-schema.sql).
4. Restart the server.

When these environment variables are present, the app uses Supabase as its primary persistence layer and keeps `data/store.json` as a local mirror/fallback cache.

## Workflow

1. Create a subscriber account.
   Enter `Name`, `Email`, and `Password`, keep the role as `subscriber`, and click `Signup`.
   The page auto-logs in and shows the token.

2. Activate the subscription.
   In the subscription section, choose `monthly` or `yearly`, keep charity percent at `10` or higher, and click `Activate`.

3. Add 5 golf scores.
   In the score section, enter a score between `1` and `45`, choose a date, and click `Add Score`.
   Repeat until you have 5 scores.

4. Check scores.
   Click `Refresh Scores`.
   Scores should appear in newest-first order.

5. Create an admin account.
   Go back to signup, use a new email, enter a password, change the role to `admin`, and click `Signup`.

6. Simulate a draw as admin.
   In admin draw controls, choose `random` or `algorithmic`, then click `Simulate Draw`.
   The output area returns a draw object with a `draw id`.

7. Publish the draw.
   Copy the `draw id`, paste it into `Draw ID to publish`, and click `Publish Draw`.

8. View results.
   The output box will show the draw details, entries, and winners if any exist.


   ## What the backend covers

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


## Data store

Application data is stored in Supabase when configured, with `data/store.json` kept as a local mirror and fallback. If Supabase env vars are missing, the app runs entirely from `data/store.json`.

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
- `docs/supabase-state-schema.sql`
- `docs/mvp-delivery-plan.md`

## Important limitation

This MVP now supports Supabase-backed persistence, but it still uses a custom Node HTTP server rather than a Vercel-native serverless or Next.js structure. Stripe checkout, Stripe webhooks, file upload infrastructure, email delivery, and a full Vercel-ready app architecture are still next-step work.
