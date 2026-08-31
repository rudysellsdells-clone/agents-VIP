create table if not exists public.qualification_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'QUEUED',
  industry text not null,
  requested_records integer not null,
  total_items integer not null default 0,
  contact_score_threshold numeric(5,1) not null default 65,
  auto_draft_priority boolean not null default false,
  draft_score_threshold numeric(5,1) not null default 80,
  counts jsonb not null default '{}'::jsonb,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qualification_jobs_requested_records_check
    check (requested_records between 1 and 100),
  constraint qualification_jobs_contact_threshold_check
    check (contact_score_threshold between 0 and 100),
  constraint qualification_jobs_draft_threshold_check
    check (draft_score_threshold between 0 and 100)
);

create table if not exists public.qualification_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.qualification_jobs(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete set null,
  industry text not null,
  company_name text not null,
  website text not null,
  prospect_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED',
  stage text not null default 'ENRICHMENT_QUEUED',
  attempts integer not null default 0,
  last_error text,
  enrichment jsonb,
  scoring jsonb,
  contact_resolution jsonb,
  outreach_package jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qualification_job_items_attempts_check
    check (attempts between 0 and 10),
  unique (job_id, website)
);

create index if not exists qualification_jobs_status_idx
  on public.qualification_jobs (status, created_at);

create index if not exists qualification_job_items_job_status_idx
  on public.qualification_job_items (job_id, status, created_at);

create index if not exists qualification_job_items_stage_idx
  on public.qualification_job_items (stage, updated_at);

create index if not exists qualification_job_items_prospect_idx
  on public.qualification_job_items (prospect_id);

alter table public.qualification_jobs enable row level security;
alter table public.qualification_job_items enable row level security;

grant select, insert, update, delete
  on table public.qualification_jobs
  to service_role;

grant select, insert, update, delete
  on table public.qualification_job_items
  to service_role;

comment on table public.qualification_jobs is
  'Durable qualification jobs orchestrating Agents 2-4, optionally Agent 5, capped at 100 prospects per job.';

comment on column public.qualification_job_items.stage is
  'Current pipeline stage such as ENRICHMENT_QUEUED, ENRICHED, SCORED, CONTACT_RESOLVED, OUTREACH_DRAFTED, STOPPED, or FAILED.';
