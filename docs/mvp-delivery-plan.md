# MVP Delivery Plan

## Implemented logic coverage

### Subscription and payment modeling
- Monthly and yearly plans are supported
- Subscribers store active, inactive, canceled, past-due, or incomplete style states
- Authenticated requests normalize lapsed subscriptions in real time
- Charity percentage is enforced at a minimum of 10%

### Score management
- Stableford score validation enforces `1-45`
- Every score requires a round date
- Only the most recent 5 scores are retained
- Score lists are returned in reverse chronological order

### Draw and reward engine
- Monthly draw records use a `YYYY-MM` month key
- Admins can simulate a draw before publishing it
- Draw generation supports random and algorithmic modes
- Publishing a draw creates entries from each eligible subscriber's latest 5 scores
- 3-match, 4-match, and 5-match winners are calculated automatically
- 5-match pools roll forward when no jackpot winner exists

### Charity system
- Public charity directory and charity detail endpoints are available
- Subscribers can set or update their chosen charity and contribution percentage
- Independent donations are tracked separately from subscription-linked donations

### Winner verification
- Winners can submit a proof URL
- Admins can approve or reject proof submissions
- Approved winners can be marked paid

### Admin controls
- Charity create, update, and archive flows exist
- Admins can view and edit users
- Admins can adjust subscription details
- Dashboard and reporting endpoints expose totals, charity contribution summaries, and draw statistics

## Still treated as next-phase integration

- Stripe checkout sessions and webhook reconciliation
- Real proof file uploads with signed storage URLs
- Email notifications
- Production deployment to Vercel and Supabase
- Frontend dashboards that fully exercise every endpoint
