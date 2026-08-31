alter table public.prospects
  add column if not exists primary_decision_maker jsonb,
  add column if not exists secondary_decision_makers jsonb not null default '[]'::jsonb,
  add column if not exists resolved_contact_paths jsonb not null default '[]'::jsonb,
  add column if not exists outreach_angle jsonb,
  add column if not exists contact_resolution_summary text,
  add column if not exists contact_resolution_confidence integer,
  add column if not exists contact_resolution_score numeric(5,1),
  add column if not exists contact_resolution_agent text,
  add column if not exists contact_resolved_at timestamptz;

do $$
begin
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
end
$$;

create index if not exists prospects_contact_resolution_confidence_idx
  on public.prospects (contact_resolution_confidence desc);

create index if not exists prospects_contact_resolution_score_idx
  on public.prospects (contact_resolution_score desc);

create index if not exists prospects_contact_resolved_at_idx
  on public.prospects (contact_resolved_at desc);

comment on column public.prospects.primary_decision_maker is
  'Highest-ranked verified public professional decision-maker resolved by Agent 4.';

comment on column public.prospects.resolved_contact_paths is
  'Verified public business contact routes resolved by Agent 4.';

comment on column public.prospects.outreach_angle is
  'Evidence-based strategic outreach angle and preferred channel for Agent 5; not outreach copy.';
