-- Reconcile the prospects table for Agents 1-5.
-- Safe to run repeatedly. This migration is intentionally idempotent.

alter table public.prospects
  add column if not exists email text,
  add column if not exists subindustry text,
  add column if not exists company_type text,
  add column if not exists company_type_confidence integer,
  add column if not exists capabilities jsonb not null default '[]'::jsonb,
  add column if not exists business_summary text,
  add column if not exists service_area text,
  add column if not exists company_size_signals jsonb not null default '[]'::jsonb,
  add column if not exists decision_makers jsonb not null default '[]'::jsonb,
  add column if not exists contact_paths jsonb not null default '[]'::jsonb,
  add column if not exists growth_signals jsonb not null default '[]'::jsonb,
  add column if not exists marketing_signals jsonb not null default '[]'::jsonb,
  add column if not exists opportunity_summary text,
  add column if not exists enrichment_confidence integer,
  add column if not exists enrichment_agent text,
  add column if not exists enriched_at timestamptz,
  add column if not exists marketing_opportunity_score numeric(5,1),
  add column if not exists score_tier text,
  add column if not exists score_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists score_version text,
  add column if not exists score_next_action text,
  add column if not exists scored_at timestamptz,
  add column if not exists primary_decision_maker jsonb,
  add column if not exists secondary_decision_makers jsonb not null default '[]'::jsonb,
  add column if not exists resolved_contact_paths jsonb not null default '[]'::jsonb,
  add column if not exists outreach_angle jsonb,
  add column if not exists contact_resolution_summary text,
  add column if not exists contact_resolution_confidence integer,
  add column if not exists contact_resolution_score numeric(5,1),
  add column if not exists contact_resolution_agent text,
  add column if not exists contact_resolved_at timestamptz,
  add column if not exists outreach_package jsonb,
  add column if not exists outreach_preferred_channel text,
  add column if not exists outreach_generation_confidence integer,
  add column if not exists outreach_agent text,
  add column if not exists outreach_generated_at timestamptz;

-- Backfill generic Agent 1 fields from the original dental-era fields.
update public.prospects
set
  company_type = coalesce(company_type, practice_type),
  company_type_confidence = coalesce(
    company_type_confidence,
    independence_confidence
  ),
  capabilities = case
    when capabilities = '[]'::jsonb and services is not null then
      coalesce(
        (
          select jsonb_agg(service.key)
          from jsonb_each(services) as service(key, value)
          where service.value = 'true'::jsonb
        ),
        '[]'::jsonb
      )
    else capabilities
  end
where industry = 'dental';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'prospects_industry_website_key'
      and conrelid = 'public.prospects'::regclass
  ) then
    alter table public.prospects
      add constraint prospects_industry_website_key
      unique (industry, website);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'prospects_company_type_confidence_check'
      and conrelid = 'public.prospects'::regclass
  ) then
    alter table public.prospects
      add constraint prospects_company_type_confidence_check
      check (
        company_type_confidence is null
        or company_type_confidence between 0 and 100
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'prospects_enrichment_confidence_check'
      and conrelid = 'public.prospects'::regclass
  ) then
    alter table public.prospects
      add constraint prospects_enrichment_confidence_check
      check (
        enrichment_confidence is null
        or enrichment_confidence between 0 and 100
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'prospects_marketing_opportunity_score_check'
      and conrelid = 'public.prospects'::regclass
  ) then
    alter table public.prospects
      add constraint prospects_marketing_opportunity_score_check
      check (
        marketing_opportunity_score is null
        or marketing_opportunity_score between 0 and 100
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'prospects_contact_resolution_confidence_check'
      and conrelid = 'public.prospects'::regclass
  ) then
    alter table public.prospects
      add constraint prospects_contact_resolution_confidence_check
      check (
        contact_resolution_confidence is null
        or contact_resolution_confidence between 0 and 100
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'prospects_contact_resolution_score_check'
      and conrelid = 'public.prospects'::regclass
  ) then
    alter table public.prospects
      add constraint prospects_contact_resolution_score_check
      check (
        contact_resolution_score is null
        or contact_resolution_score between 0 and 100
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'prospects_outreach_generation_confidence_check'
      and conrelid = 'public.prospects'::regclass
  ) then
    alter table public.prospects
      add constraint prospects_outreach_generation_confidence_check
      check (
        outreach_generation_confidence is null
        or outreach_generation_confidence between 0 and 100
      );
  end if;
end
$$;

create index if not exists prospects_status_idx
  on public.prospects (status);

create index if not exists prospects_industry_market_idx
  on public.prospects (industry, market);

create index if not exists prospects_discovery_confidence_idx
  on public.prospects (discovery_confidence desc);

create index if not exists prospects_industry_subindustry_idx
  on public.prospects (industry, subindustry);

create index if not exists prospects_company_type_idx
  on public.prospects (company_type);

create index if not exists prospects_company_type_confidence_idx
  on public.prospects (company_type_confidence desc);

create index if not exists prospects_email_idx
  on public.prospects (email)
  where email is not null;

create index if not exists prospects_enrichment_confidence_idx
  on public.prospects (enrichment_confidence desc);

create index if not exists prospects_enriched_at_idx
  on public.prospects (enriched_at desc);

create index if not exists prospects_marketing_opportunity_score_idx
  on public.prospects (marketing_opportunity_score desc);

create index if not exists prospects_score_tier_idx
  on public.prospects (score_tier);

create index if not exists prospects_scored_at_idx
  on public.prospects (scored_at desc);

create index if not exists prospects_contact_resolution_confidence_idx
  on public.prospects (contact_resolution_confidence desc);

create index if not exists prospects_contact_resolution_score_idx
  on public.prospects (contact_resolution_score desc);

create index if not exists prospects_contact_resolved_at_idx
  on public.prospects (contact_resolved_at desc);

create index if not exists prospects_outreach_preferred_channel_idx
  on public.prospects (outreach_preferred_channel);

create index if not exists prospects_outreach_generated_at_idx
  on public.prospects (outreach_generated_at desc);

alter table public.prospects enable row level security;

-- Backend secret/service-role access. Secret keys map to the service_role
-- database role; legacy service_role JWTs use the same role.
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.prospects to service_role;

comment on table public.prospects is
  'B2B prospects discovered, enriched, scored, contact-resolved, and prepared for outreach by VIP prospecting agents.';
