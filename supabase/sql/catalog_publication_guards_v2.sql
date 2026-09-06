-- Catalog publication guards v2.
--
-- Ingestion is intentionally broad. Publication is not. This migration adds
-- explicit editorial holds and a component manifest for canonical editions
-- assembled from multiple public-domain source volumes.

create table if not exists public.catalog_publication_holds (
  work_id text primary key references public.works(id) on delete cascade,
  reason_code text not null,
  note text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.edition_components (
  edition_id text not null references public.editions(id) on delete cascade,
  position integer not null check (position > 0),
  component_edition_id text not null references public.editions(id),
  label text,
  created_at timestamptz not null default now(),
  primary key (edition_id, position),
  unique (edition_id, component_edition_id),
  check (edition_id <> component_edition_id)
);

create index if not exists edition_components_component_idx
  on public.edition_components(component_edition_id);

alter table public.catalog_publication_holds enable row level security;
alter table public.edition_components enable row level security;
revoke all on public.catalog_publication_holds from anon, authenticated;
revoke all on public.edition_components from anon, authenticated;
grant all on public.catalog_publication_holds to service_role;
grant all on public.edition_components to service_role;

-- Fail-closed curated publication now refuses editorially held Works before
-- checking the structural/readiness gates from v1.
create or replace function public.publish_free_catalog_works(p_work_ids text[])
returns table(
  work_id text,
  title text,
  publication_status text,
  free_enabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested int;
  v_found int;
  v_invalid text[];
  v_held text[];
begin
  if p_work_ids is null or cardinality(p_work_ids) = 0 then
    raise exception 'p_work_ids must contain at least one work id';
  end if;

  select count(distinct x)
  into v_requested
  from unnest(p_work_ids) x
  where nullif(btrim(x), '') is not null;

  if v_requested = 0 then
    raise exception 'p_work_ids contains no non-empty work ids';
  end if;

  select count(*)
  into v_found
  from public.works w
  where w.id in (
    select distinct x from unnest(p_work_ids) x
    where nullif(btrim(x), '') is not null
  );

  if v_found <> v_requested then
    raise exception 'publication batch contains unknown work ids: requested %, found %',
      v_requested, v_found;
  end if;

  select array_agg(h.work_id order by h.work_id)
  into v_held
  from public.catalog_publication_holds h
  where h.enabled
    and h.work_id in (
      select distinct x from unnest(p_work_ids) x
      where nullif(btrim(x), '') is not null
    );

  if v_held is not null then
    raise exception 'publication batch contains editorially held work ids: %',
      array_to_string(v_held, ', ');
  end if;

  select array_agg(w.id order by w.id)
  into v_invalid
  from public.works w
  left join public.work_readiness wr on wr.work_id = w.id
  where w.id in (
    select distinct x from unnest(p_work_ids) x
    where nullif(btrim(x), '') is not null
  )
  and (
    w.publication_status not in ('draft', 'published')
    or wr.catalog_ready is distinct from true
    or not exists (
      select 1
      from public.editions e
      where e.work_id = w.id
        and e.ingestion_status = 'ready'
        and exists (
          select 1
          from public.book_files bf
          where bf.edition_id = e.id
            and bf.kind = 'normalized'
            and bf.format = 'anki-json'
            and bf.ingestion_status = 'ready'
        )
        and exists (
          select 1
          from public.rights_assertions ra
          where ra.edition_id = e.id
            and ra.status = 'public-domain'
            and ra.jurisdiction = 'DE'
        )
    )
  );

  if v_invalid is not null then
    raise exception 'publication safety gate failed for work ids: %',
      array_to_string(v_invalid, ', ');
  end if;

  update public.works w
  set publication_status = 'published'
  where w.id in (
    select distinct x from unnest(p_work_ids) x
    where nullif(btrim(x), '') is not null
  )
  and w.publication_status = 'draft';

  insert into public.free_catalog_works(work_id, enabled)
  select distinct x, true
  from unnest(p_work_ids) x
  where nullif(btrim(x), '') is not null
  on conflict(work_id) do update set enabled = excluded.enabled;

  return query
  select w.id,
         w.title,
         w.publication_status,
         coalesce(f.enabled, false)
  from public.works w
  left join public.free_catalog_works f on f.work_id = w.id
  where w.id in (
    select distinct x from unnest(p_work_ids) x
    where nullif(btrim(x), '') is not null
  )
  order by w.id;
end;
$$;

revoke all on function public.publish_free_catalog_works(text[]) from public;
grant execute on function public.publish_free_catalog_works(text[]) to service_role;
