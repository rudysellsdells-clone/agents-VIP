alter table public.prospects
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
  add column if not exists enriched_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'prospects_enrichment_confidence_check'
  ) then
    alter table public.prospects
      add constraint prospects_enrichment_confidence_check
      check (
        enrichment_confidence is null
        or enrichment_confidence between 0 and 100
      );
  end if;
end
$$;

create index if not exists prospects_enrichment_confidence_idx
  on public.prospects (enrichment_confidence desc);

create index if not exists prospects_enriched_at_idx
  on public.prospects (enriched_at desc);

comment on column public.prospects.decision_makers is
  'Public professional decision-makers and evidence identified by Agent 2.';

comment on column public.prospects.contact_paths is
  'Verified public business contact paths identified during enrichment.';

comment on column public.prospects.marketing_signals is
  'Evidence-based marketing strengths and opportunity observations; not a final opportunity score.';

comment on column public.prospects.growth_signals is
  'Public business growth and investment signals identified during enrichment.';
