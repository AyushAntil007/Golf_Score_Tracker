# API Spec (MVP)

## Auth & Profile
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/me`
- `PATCH /api/me`

## Subscription
- `POST /api/subscriptions/checkout-session` (monthly/yearly)
- `POST /api/webhooks/stripe`
- `GET /api/subscriptions/current`
- `POST /api/subscriptions/cancel`

## Charities
- `GET /api/charities`
- `GET /api/charities/:id`
- `POST /api/me/charity-preference`
- `POST /api/donations`

## Scores
- `GET /api/scores`
- `POST /api/scores`
- `PATCH /api/scores/:id`
- `DELETE /api/scores/:id`

Business rules:
- Score range 1–45
- Date required
- On insert, if count > 5 for user, delete oldest entry

## Draws (User)
- `GET /api/draws/upcoming`
- `GET /api/draws/history`
- `GET /api/draws/:id/result`

## Draws (Admin)
- `POST /api/admin/draws/simulate`
- `POST /api/admin/draws/:id/publish`
- `GET /api/admin/draws/:id/winners`

## Winner Verification
- `POST /api/winners/:id/proof-upload-url`
- `POST /api/winners/:id/proof-complete`
- `POST /api/admin/winners/:id/verify` (approve/reject)
- `POST /api/admin/winners/:id/mark-paid`

## Admin Reporting
- `GET /api/admin/reports/overview`
- `GET /api/admin/reports/charity-contributions`
- `GET /api/admin/reports/draw-stats`

