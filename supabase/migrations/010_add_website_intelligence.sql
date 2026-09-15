alter table public.prospects
  add column if not exists website_audit_id uuid,
  add column if not exists website_audit_version text,
  add column if not exists website_audited_at timestamptz,
  add column if not exists website_health_score numeric(5,1),
  add column if not exists content_freshness_score numeric(5,1),
  add column if not exists site_structure_score numeric(5,1),
  add column if not exists conversion_score numeric(5,1),
  add column if not exists technical_seo_score numeric(5,1),
  add column if not exists performance_score numeric(5,1),
  add column if not exists mobile_score numeric(5,1),
  add column if not exists accessibility_score numeric(5,1),
  add column if not exists structured_data_score numeric(5,1),
  add column if not exists platform_health_score numeric(5,1),
  add column if not exists trust_score numeric(5,1),
  add column if not exists ai_discoverability_score numeric(5,1),
  add column if not exists website_audit_summary jsonb;

create table if not exists public.website_audits (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references public.prospects(id) on delete set null,
  industry text not null,
  company_name text not null,
  website text not null,
  audit_version text not null,
  audit_depth text not null default 'standard',
  pages_discovered integer not null default 0,
  pages_sampled integer not null default 0,
  robots_accessible boolean,
  sitemap_found boolean,
  sitemap_urls_count integer,
  website_health_score numeric(5,1),
  scores jsonb not null default '{}'::jsonb,
  content_freshness jsonb not null default '{}'::jsonb,
  structure jsonb not null default '{}'::jsonb,
  conversion jsonb not null default '{}'::jsonb,
  technical_seo jsonb not null default '{}'::jsonb,
  performance jsonb not null default '{}'::jsonb,
  mobile jsonb not null default '{}'::jsonb,
  accessibility jsonb not null default '{}'::jsonb,
  structured_data jsonb not null default '{}'::jsonb,
  platform jsonb not null default '{}'::jsonb,
  site_hygiene jsonb not null default '{}'::jsonb,
  trust jsonb not null default '{}'::jsonb,
  ai_discoverability jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  audit_confidence integer,
  pagespeed_available boolean not null default false,
  pagespeed_error text,
  audited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint website_audits_confidence_check
    check (audit_confidence is null or audit_confidence between 0 and 100),
  constraint website_audits_health_check
    check (website_health_score is null or website_health_score between 0 and 100)
);

create table if not exists public.website_audit_pages (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.website_audits(id) on delete cascade,
  url text not null,
  page_type text,
  http_status integer,
  title text,
  title_length integer,
  meta_description text,
  canonical text,
  h1 text,
  h1_count integer,
  heading_count integer,
  heading_order_issues integer,
  word_count integer,
  published_date timestamptz,
  modified_date timestamptz,
  estimated_content_age_days integer,
  content_stale boolean,
  internal_links integer,
  external_links integer,
  images integer,
  missing_alt_images integer,
  forms integer,
  primary_cta text,
  has_viewport boolean,
  schema_types jsonb not null default '[]'::jsonb,
  cms_signals jsonb not null default '[]'::jsonb,
  content_quality_score numeric(5,1),
  conversion_score numeric(5,1),
  technical_seo_score numeric(5,1),
  findings jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (audit_id, url),
  constraint website_audit_pages_content_quality_check
    check (content_quality_score is null or content_quality_score between 0 and 100),
  constraint website_audit_pages_conversion_check
    check (conversion_score is null or conversion_score between 0 and 100),
  constraint website_audit_pages_technical_seo_check
    check (technical_seo_score is null or technical_seo_score between 0 and 100)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'prospects_website_audit_id_fkey'
      and conrelid = 'public.prospects'::regclass
  ) then
    alter table public.prospects
      add constraint prospects_website_audit_id_fkey
      foreign key (website_audit_id)
      references public.website_audits(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'prospects_website_health_score_check'
      and conrelid = 'public.prospects'::regclass
  ) then
    alter table public.prospects
      add constraint prospects_website_health_score_check
      check (website_health_score is null or website_health_score between 0 and 100);
  end if;
end
$$;

create index if not exists website_audits_website_audited_idx
  on public.website_audits (website, audited_at desc);

create index if not exists website_audits_prospect_idx
  on public.website_audits (prospect_id, audited_at desc);

create index if not exists website_audits_health_idx
  on public.website_audits (website_health_score);

create index if not exists website_audit_pages_audit_idx
  on public.website_audit_pages (audit_id);

create index if not exists prospects_website_health_idx
  on public.prospects (website_health_score);

alter table public.website_audits enable row level security;
alter table public.website_audit_pages enable row level security;

grant select, insert, update, delete on table public.website_audits to service_role;
grant select, insert, update, delete on table public.website_audit_pages to service_role;

comment on table public.website_audits is
  'Versioned site-level website intelligence audits used by Agent 2 and downstream outreach.';

comment on table public.website_audit_pages is
  'Sampled page-level measurements and evidence supporting a website intelligence audit.';

comment on column public.prospects.website_health_score is
  'Diagnostic website quality score, kept separate from the Marketing Opportunity Score.';
