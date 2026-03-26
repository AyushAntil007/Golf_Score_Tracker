-- PostgreSQL schema for Golf Charity Subscription Platform
-- Compatible with Supabase/Postgres 15+

create extension if not exists pgcrypto;

-- ---------- ENUMS ----------
create type user_role as enum ('subscriber', 'admin');
create type subscription_plan as enum ('monthly', 'yearly');
create type subscription_status as enum ('inactive', 'active', 'past_due', 'canceled', 'incomplete');
create type draw_mode as enum ('random', 'algorithmic');
create type draw_status as enum ('simulated', 'published');
create type verification_status as enum ('pending', 'approved', 'rejected');
create type payout_status as enum ('pending', 'paid');

-- ---------- USERS ----------
create table app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  role user_role not null default 'subscriber',
  created_at timestamptz not null default now()
);

-- ---------- CHARITIES ----------
create table charities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  image_url text,
  featured boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table user_charity_preferences (
  user_id uuid primary key references app_users(id) on delete cascade,
  charity_id uuid not null references charities(id),
  contribution_percent numeric(5,2) not null check (contribution_percent >= 10 and contribution_percent <= 100),
  updated_at timestamptz not null default now()
);

-- ---------- SUBSCRIPTIONS ----------
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  plan subscription_plan not null,
  status subscription_status not null,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_subscriptions_user_status on subscriptions(user_id, status);

-- ---------- SCORES ----------
create table user_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  score smallint not null check (score between 1 and 45),
  played_on date not null,
  created_at timestamptz not null default now()
);

create index idx_user_scores_user_played_on on user_scores(user_id, played_on desc, created_at desc);

-- ---------- DRAWS ----------
create table draws (
  id uuid primary key default gen_random_uuid(),
  month_key text not null unique, -- format: YYYY-MM
  mode draw_mode not null,
  status draw_status not null,
  drawn_numbers smallint[] not null check (array_length(drawn_numbers, 1) = 5),
  simulated_at timestamptz,
  published_at timestamptz,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

-- ---------- PRIZE POOLS ----------
create table prize_pool_snapshots (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null unique references draws(id) on delete cascade,
  active_subscribers integer not null check (active_subscribers >= 0),
  total_pool numeric(12,2) not null check (total_pool >= 0),
  pool_5_match numeric(12,2) not null check (pool_5_match >= 0),
  pool_4_match numeric(12,2) not null check (pool_4_match >= 0),
  pool_3_match numeric(12,2) not null check (pool_3_match >= 0),
  rollover_from_previous numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  check (round((pool_5_match + pool_4_match + pool_3_match)::numeric, 2) = round(total_pool::numeric, 2))
);

-- ---------- DRAW ENTRIES ----------
create table draw_entries (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references draws(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  numbers smallint[] not null check (array_length(numbers, 1) = 5),
  match_count smallint not null check (match_count between 0 and 5),
  created_at timestamptz not null default now(),
  unique(draw_id, user_id)
);

create index idx_draw_entries_draw_match on draw_entries(draw_id, match_count);

-- ---------- WINNERS ----------
create table winners (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references draws(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  match_tier smallint not null check (match_tier in (3,4,5)),
  prize_amount numeric(12,2) not null check (prize_amount >= 0),
  verification_status verification_status not null default 'pending',
  payout_status payout_status not null default 'pending',
  verified_by uuid references app_users(id),
  verified_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(draw_id, user_id, match_tier)
);

-- ---------- PROOF UPLOADS ----------
create table winner_proofs (
  id uuid primary key default gen_random_uuid(),
  winner_id uuid not null unique references winners(id) on delete cascade,
  storage_path text not null,
  uploaded_at timestamptz not null default now()
);

-- ---------- CHARITY DONATIONS ----------
create table charity_donations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  charity_id uuid not null references charities(id),
  amount numeric(12,2) not null check (amount > 0),
  source text not null check (source in ('subscription', 'independent')),
  created_at timestamptz not null default now()
);

-- ---------- ADMIN AUDIT ----------
create table admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references app_users(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_admin_audit_logs_created_at on admin_audit_logs(created_at desc);

