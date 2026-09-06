-- Complete Free startup-catalog payload for omnia-catalog.
--
-- Why this exists:
-- Supabase/PostgREST applies a server-side max-row cap to normal table
-- selects. omnia-catalog used to fetch works/authors/editions/files/rights
-- with unpaginated .select() calls and then join/filter them in TypeScript.
-- When production's cap was 10, the endpoint silently returned only a small
-- prefix of an otherwise valid published catalog.
--
-- Returning all source arrays inside ONE jsonb value makes the RPC itself a
-- single result row, so PostgREST's row cap cannot truncate the underlying
-- catalog. The public boundary is still exactly the same:
--   works.publication_status = 'published'
--   AND work_readiness.catalog_ready = true
--   AND free_catalog_works.enabled = true
--
-- Edition provenance is part of the payload. source_id/external_id must not
-- be replaced with a hard-coded provider in the Edge Function because the
-- catalog now contains Gutenberg, Wikisource, Wolne Lektury, LoC and other
-- providers side by side.
--
-- The function is executable only by service_role; browsers continue to use
-- the public omnia-catalog Edge Function rather than calling this RPC.

create or replace function public.get_free_startup_catalog_data()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with public_works as (
  select w.*
  from public.works w
  join public.work_readiness wr
    on wr.work_id = w.id
   and wr.catalog_ready = true
  join public.free_catalog_works fcw
    on fcw.work_id = w.id
   and fcw.enabled = true
  where w.publication_status = 'published'
), referenced_authors as (
  select distinct w.author_id
  from public_works w
), public_editions as (
  select e.id,
         e.work_id,
         e.language,
         e.is_original,
         e.translator_name,
         e.source_id,
         e.external_id,
         e.ingestion_status
  from public.editions e
  join public_works w on w.id = e.work_id
), public_files as (
  select bf.id,
         bf.edition_id,
         bf.kind,
         bf.format,
         bf.ingestion_status
  from public.book_files bf
  join public_editions e on e.id = bf.edition_id
  where bf.kind = 'normalized'
), public_rights as (
  select ra.edition_id,
         ra.status,
         ra.jurisdiction
  from public.rights_assertions ra
  join public_editions e on e.id = ra.edition_id
)
select jsonb_build_object(
  'works', coalesce(
    (select jsonb_agg(to_jsonb(w) order by w.id) from public_works w),
    '[]'::jsonb
  ),
  'authors', coalesce(
    (
      select jsonb_agg(to_jsonb(a) order by a.id)
      from public.authors a
      join referenced_authors r on r.author_id = a.id
    ),
    '[]'::jsonb
  ),
  'editions', coalesce(
    (select jsonb_agg(to_jsonb(e) order by e.id) from public_editions e),
    '[]'::jsonb
  ),
  'files', coalesce(
    (select jsonb_agg(to_jsonb(f) order by f.id) from public_files f),
    '[]'::jsonb
  ),
  'rights', coalesce(
    (
      select jsonb_agg(to_jsonb(r) order by r.edition_id, r.jurisdiction, r.status)
      from public_rights r
    ),
    '[]'::jsonb
  )
);
$$;

revoke all on function public.get_free_startup_catalog_data() from public;
grant execute on function public.get_free_startup_catalog_data() to service_role;
