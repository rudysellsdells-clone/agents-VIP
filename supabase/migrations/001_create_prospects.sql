create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  industry text not null,
  company_name text not null,
  website text not null,
  phone text,
  city text,
  state text,
  status text not null default 'DISCOVERED',
  market text,
  radius_miles integer,
  practice_type text,
  independence_confidence integer,
  discovery_confidence integer,
  services jsonb not null default '{}'::jsonb,
  fit_reasons jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  discovery_agent text,
  last_discovered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospects_industry_website_key unique (industry, website),
  constraint prospects_independence_confidence_check
    check (
      independence_confidence is null
      or independence_confidence between 0 and 100
    ),
  constraint prospects_discovery_confidence_check
    check (
      discovery_confidence is null
      or discovery_confidence between 0 and 100
    )
);

create index if not exists prospects_status_idx
  on public.prospects (status);

create index if not exists prospects_industry_market_idx
  on public.prospects (industry, market);

create index if not exists prospects_discovery_confidence_idx
  on public.prospects (discovery_confidence desc);

alter table public.prospects enable row level security;

comment on table public.prospects is
  'B2B companies discovered by VIP prospecting agents. Server-side secret/service credentials only in V1.';
