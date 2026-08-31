alter table public.prospects
  add column if not exists email text;

create index if not exists prospects_email_idx
  on public.prospects (email)
  where email is not null;

comment on column public.prospects.email is
  'Verified public business-contact email published by the prospect or another credible public business source. Never inferred or pattern-generated.';
