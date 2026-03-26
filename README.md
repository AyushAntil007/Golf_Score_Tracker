# Golf Charity Subscription Platform (Working MVP)

This is a runnable MVP implementation for the assignment.

## Implemented Features

- User signup/login with role support (`subscriber`, `admin`)
- Subscription activation (`monthly` / `yearly`) with minimum 10% charity contribution
- Score entry with validation (1–45) and automatic latest-5 retention
- Charity listing + admin charity creation
- Draw simulation (`random` / `algorithmic`) and publish flow
- Winner generation for 3/4/5 match tiers
- Winner proof submission + admin verify + mark paid
- Admin overview report endpoint
- Simple web UI for manual end-to-end demo

## Run

```bash
npm run dev
```

Open: `http://localhost:3000`

## Data (store format)

All data is stored in `data/store.json`.

### Top-level keys

- `users`: registered users (`subscriber` or `admin`)
- `sessions`: active login tokens
- `charities`: charity directory entries
- `subscriptions`: plan/status/renewal + charity percentage
- `scores`: user score history
- `draws`: simulated/published monthly draws
- `winners`: winners and verification/payment states
- `donations`: standalone donation records (reserved for extension)

### Example record shapes

```json
{
  "users": [{ "id": "u_x", "email": "a@b.com", "passwordHash": "...", "role": "subscriber" }],
  "subscriptions": [{ "userId": "u_x", "plan": "monthly", "status": "active", "charityPercent": 10 }],
  "scores": [{ "id": "s_x", "userId": "u_x", "score": 34, "playedOn": "2026-03-01" }],
  "draws": [{ "id": "d_x", "monthKey": "2026-03", "mode": "random", "status": "published", "numbers": [3,8,14,22,41] }],
  "winners": [{ "id": "w_x", "drawId": "d_x", "userId": "u_x", "matchTier": 3, "prizeAmount": 25, "verificationStatus": "pending", "payoutStatus": "pending" }]
}
```

## API Quick List

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/me`
- `POST /api/subscriptions/activate`
- `GET /api/charities`
- `POST /api/admin/charities`
- `GET /api/scores`
- `POST /api/scores`
- `POST /api/admin/draws/simulate`
- `POST /api/admin/draws/:id/publish`
- `GET /api/winners/me`
- `POST /api/winners/:id/proof`
- `POST /api/admin/winners/:id/verify`
- `POST /api/admin/winners/:id/mark-paid`
- `GET /api/admin/reports/overview`

## Important Notes

- This is an assignment MVP with a JSON file datastore (`data/store.json`) for quick setup.
- Stripe/Supabase integration can be added as the next step if required by evaluation.
