alter table public.prospects
  add column if not exists outreach_package jsonb,
  add column if not exists outreach_preferred_channel text,
  add column if not exists outreach_generation_confidence integer,
  add column if not exists outreach_agent text,
  add column if not exists outreach_generated_at timestamptz;

do $$
begin
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

create index if not exists prospects_outreach_preferred_channel_idx
  on public.prospects (outreach_preferred_channel);

create index if not exists prospects_outreach_generated_at_idx
  on public.prospects (outreach_generated_at desc);

comment on column public.prospects.outreach_package is
  'Agent 5 personalized outreach draft package. Draft-only; no sending occurs in this stage.';

comment on column public.prospects.outreach_preferred_channel is
  'Agent 4 recommended channel carried into the Agent 5 draft package.';
