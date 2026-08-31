alter table public.prospects
  add column if not exists subindustry text,
  add column if not exists company_type text,
  add column if not exists company_type_confidence integer,
  add column if not exists capabilities jsonb not null default '[]'::jsonb;

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
    where conname = 'prospects_company_type_confidence_check'
  ) then
    alter table public.prospects
      add constraint prospects_company_type_confidence_check
      check (
        company_type_confidence is null
        or company_type_confidence between 0 and 100
      );
  end if;
end
$$;

create index if not exists prospects_industry_subindustry_idx
  on public.prospects (industry, subindustry);

create index if not exists prospects_company_type_idx
  on public.prospects (company_type);

create index if not exists prospects_company_type_confidence_idx
  on public.prospects (company_type_confidence desc);

comment on column public.prospects.capabilities is
  'Industry-specific capability IDs verified during prospect discovery.';

comment on column public.prospects.company_type is
  'Generic business structure classification: independent, small_group, regional, or unknown.';
