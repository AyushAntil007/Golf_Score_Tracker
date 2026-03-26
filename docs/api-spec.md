# API Spec

## Auth and Profile
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/me`
- `PATCH /api/me`
- `GET /api/dashboard`

## Subscription
- `GET /api/subscriptions/current`
- `POST /api/subscriptions/activate`
- `POST /api/subscriptions/cancel`

Business rules:
- Plans: `monthly`, `yearly`
- Minimum charity contribution: `10%`
- Subscription status is normalized on authenticated requests
- Score entry and draw eligibility require an active subscription

## Charities and Donations
- `GET /api/charities`
- `GET /api/charities/:id`
- `POST /api/me/charity-preference`
- `POST /api/donations`
- `POST /api/admin/charities`
- `PATCH /api/admin/charities/:id`
- `DELETE /api/admin/charities/:id`

Business rules:
- Charity listings support featured filtering and search
- Independent donations are tracked separately from subscription-derived charity contributions
- Archived charities are hidden from public lookups

## Scores
- `GET /api/scores`
- `POST /api/scores`
- `PATCH /api/scores/:id`
- `DELETE /api/scores/:id`

Business rules:
- Stableford score range: `1-45`
- `playedOn` is required in `YYYY-MM-DD`
- Only the latest 5 scores are retained per subscriber
- Scores are returned most recent first

## Draws
- `GET /api/draws`
- `GET /api/draws/upcoming`
- `GET /api/draws/history`
- `GET /api/draws/:id/result`
- `POST /api/admin/draws/simulate`
- `POST /api/admin/draws/:id/publish`
- `GET /api/admin/draws/:id/winners`

Business rules:
- Draw modes: `random`, `algorithmic`
- Draw states: `simulated`, `published`
- Prize split: `40%` for 5-match, `35%` for 4-match, `25%` for 3-match
- 5-match jackpot rolls over when unclaimed
- Only subscribers with 5 retained scores are entered into a published draw

## Winner Verification
- `GET /api/winners/me`
- `POST /api/winners/:id/proof`
- `POST /api/admin/winners/:id/verify`
- `POST /api/admin/winners/:id/mark-paid`

Business rules:
- Winner proof is required before approval
- Verification actions: `approve`, `reject`
- Payout flow: `pending -> paid`

## Admin Management and Reporting
- `GET /api/admin/dashboard`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id`
- `PATCH /api/admin/subscriptions/:userId`
- `GET /api/admin/reports/overview`
- `GET /api/admin/reports/charity-contributions`
- `GET /api/admin/reports/draw-stats`

## Notes
- The current MVP uses a JSON datastore at `data/store.json`
- Subscription billing is modeled in-app for now, so Stripe webhook routes are still a future integration step
