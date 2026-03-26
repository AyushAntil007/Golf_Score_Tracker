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
npm install
npm run dev
```

Open: `http://localhost:3000`

## Important Notes

- This is an assignment MVP with a JSON file datastore (`data/store.json`) for quick setup.
- Stripe/Supabase integration can be added as the next step if required by evaluation.

