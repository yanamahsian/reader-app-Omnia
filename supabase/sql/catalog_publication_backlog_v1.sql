-- Editorial publication-backlog audit for the Free catalog.
--
-- Ingestion is intentionally broad; this function surfaces structurally
-- readable/public-domain drafts together with warning flags so editorial
-- publication can remain explicit rather than becoming "publish everything".
-- It is read-only and service-role-only.

create or replace function public.get_catalog_publication_backlog(
  p_author_ids text[] default null,
  p_limit integer default 250
)
returns table(
  work_id text,
  title text,
  author_id text,
  author_name text,
  publication_status text,
  reader_ready boolean,
  catalog_ready boolean,
  de_public_domain_ready boolean,
  free_enabled boolean,
  languages text[],
  source_ids text[],
  same_author_title_duplicates integer,
  review_flags text[]
)
language sql
stable
security definer
set search_path = public
as $$
with base as (
  select
    w.id as work_id,
    w.title,
    w.author_id,
    a.name as author_name,
    w.publication_status,
    coalesce(wr.reader_ready,false) as reader_ready,
    coalesce(wr.catalog_ready,false) as catalog_ready,
    exists (
      select 1
      from public.editions e
      where e.work_id=w.id
        and e.ingestion_status='ready'
        and exists (
          select 1
          from public.book_files bf
          where bf.edition_id=e.id
            and bf.kind='normalized'
            and bf.format='anki-json'
            and bf.ingestion_status='ready'
        )
        and exists (
          select 1
          from public.rights_assertions ra
          where ra.edition_id=e.id
            and ra.status='public-domain'
            and ra.jurisdiction='DE'
        )
    ) as de_public_domain_ready,
    exists (
      select 1 from public.free_catalog_works f
      where f.work_id=w.id and f.enabled
    ) as free_enabled,
    coalesce((
      select array_agg(distinct e.language order by e.language)
      from public.editions e
      where e.work_id=w.id and e.ingestion_status='ready'
    ),'{}'::text[]) as languages,
    coalesce((
      select array_agg(distinct e.source_id order by e.source_id)
      from public.editions e
      where e.work_id=w.id and e.ingestion_status='ready' and e.source_id is not null
    ),'{}'::text[]) as source_ids
  from public.works w
  join public.authors a on a.id=w.author_id
  left join public.work_readiness wr on wr.work_id=w.id
  where p_author_ids is null or w.author_id=any(p_author_ids)
), dup as (
  select author_id,lower(regexp_replace(title,'\s+',' ','g')) title_key,count(*)::int n
  from base
  group by author_id,lower(regexp_replace(title,'\s+',' ','g'))
), scored as (
  select
    b.*,
    d.n as same_author_title_duplicates,
    array_remove(array[
      case when b.publication_status='hidden' then 'hidden' end,
      case when not b.reader_ready then 'reader_not_ready' end,
      case when not b.catalog_ready then 'catalog_not_ready' end,
      case when not b.de_public_domain_ready then 'no_de_public_domain_ready_edition' end,
      case when b.free_enabled then 'already_free' end,
      case when d.n>1 then 'duplicate_title_same_author' end,
      case when b.title ~* '(tome|volume|vol\.|partie|(^|[[:space:]])part[[:space:]]+[ivx0-9]+|(^|[[:space:]])book[[:space:]]+[ivx0-9]+)' then 'volume_or_part_title' end,
      case when b.title ~ '[,;:]$' then 'source_title_punctuation_noise' end
    ],null) as review_flags
  from base b
  join dup d
    on d.author_id=b.author_id
   and d.title_key=lower(regexp_replace(b.title,'\s+',' ','g'))
)
select
  work_id,title,author_id,author_name,publication_status,reader_ready,catalog_ready,
  de_public_domain_ready,free_enabled,languages,source_ids,same_author_title_duplicates,
  review_flags
from scored
where publication_status in ('draft','published','hidden')
order by
  free_enabled asc,
  (catalog_ready and de_public_domain_ready) desc,
  cardinality(review_flags) asc,
  author_name,
  title,
  work_id
limit greatest(1,least(coalesce(p_limit,250),2000));
$$;

revoke all on function public.get_catalog_publication_backlog(text[],integer) from public;
grant execute on function public.get_catalog_publication_backlog(text[],integer) to service_role;
