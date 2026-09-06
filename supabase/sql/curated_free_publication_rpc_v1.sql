-- Fail-closed publication helper for curated Free-catalog batches.
--
-- This deliberately does NOT auto-publish the whole readiness backlog.
-- Master-corpus discovery can contain bibliographic noise, collections and
-- source artifacts, so editorial selection stays explicit: callers pass an
-- approved list of work ids. The database then enforces the non-negotiable
-- runtime gates before any publication flag is changed.
--
-- Required for every requested work:
--   * existing work id;
--   * publication_status is draft or already published;
--   * work_readiness.catalog_ready = true;
--   * at least one ready normalized AN.KI JSON file;
--   * that edition has a public-domain assertion for DE.
--
-- The function is idempotent. If every work passes, it publishes draft works
-- and enables their Free-catalog membership in the same transaction. If even
-- one work fails, the whole batch fails without partial publication.

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
    select distinct x
    from unnest(p_work_ids) x
    where nullif(btrim(x), '') is not null
  );

  if v_found <> v_requested then
    raise exception 'publication batch contains unknown work ids: requested %, found %',
      v_requested, v_found;
  end if;

  select array_agg(w.id order by w.id)
  into v_invalid
  from public.works w
  left join public.work_readiness wr on wr.work_id = w.id
  where w.id in (
    select distinct x
    from unnest(p_work_ids) x
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
    select distinct x
    from unnest(p_work_ids) x
    where nullif(btrim(x), '') is not null
  )
  and w.publication_status = 'draft';

  insert into public.free_catalog_works(work_id, enabled)
  select distinct x, true
  from unnest(p_work_ids) x
  where nullif(btrim(x), '') is not null
  on conflict on constraint free_catalog_works_pkey do update
    set enabled = excluded.enabled;

  return query
  select w.id,
         w.title,
         w.publication_status,
         coalesce(f.enabled, false)
  from public.works w
  left join public.free_catalog_works f on f.work_id = w.id
  where w.id in (
    select distinct x
    from unnest(p_work_ids) x
    where nullif(btrim(x), '') is not null
  )
  order by w.id;
end;
$$;

revoke all on function public.publish_free_catalog_works(text[]) from public;
grant execute on function public.publish_free_catalog_works(text[]) to service_role;
