alter table public.prospects
  add column if not exists marketing_opportunity_score numeric(5,1),
  add column if not exists score_tier text,
  add column if not exists score_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists score_version text,
  add column if not exists score_next_action text,
  add column if not exists scored_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'prospects_marketing_opportunity_score_check'
  ) then
    alter table public.prospects
      add constraint prospects_marketing_opportunity_score_check
      check (
        marketing_opportunity_score is null
        or marketing_opportunity_score between 0 and 100
      );
  end if;
end
$$;

create index if not exists prospects_marketing_opportunity_score_idx
  on public.prospects (marketing_opportunity_score desc);

create index if not exists prospects_score_tier_idx
  on public.prospects (score_tier);

create index if not exists prospects_scored_at_idx
  on public.prospects (scored_at desc);

comment on column public.prospects.marketing_opportunity_score is
  'Deterministic 0-100 Marketing Opportunity Score calculated by Agent 3.';

comment on column public.prospects.score_breakdown is
  'Auditable Agent 3 category scores, maximums, and evidence-derived reasons.';

comment on column public.prospects.score_version is
  'Version identifier for the deterministic scoring formula.';
