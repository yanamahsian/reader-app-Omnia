-- Curated Free-catalog publication wave executed in production on 2026-09-06.
--
-- This file is an operational record, not an automatic migration. It is
-- intentionally explicit: each work was checked for catalog_ready, a ready
-- normalized AN.KI JSON file, and a public-domain DE rights assertion before
-- publication through public.publish_free_catalog_works(text[]).
--
-- Do not replace this with "publish every ready draft" logic. Discovery and
-- ingestion are broad; publication remains editorially curated and fail-closed.

-- Alexandre Dumas (père): complete/single-work records only; split-volume
-- Monte-Cristo / Reine Margot / Dame de Monsoreau records are deliberately
-- held back until canonical volume grouping is solved.
select * from public.publish_free_catalog_works(array[
  'les-trois-mousquetaires',
  'vingt-ans-apr-s',
  'georges-2',
  'le-chevalier-de-maison-rouge-2',
  'le-chevalier-dharmental-2',
  'les-compagnons-de-j-hu',
  'les-mille-et-un-fant-mes',
  'la-femme-au-collier-de-velours',
  'act'
]);

-- Victor Hugo: complete/single-work records only. Les Misérables and
-- Notre-Dame de Paris are held back because current source records are split
-- into tomes and should not appear as separate top-level catalog Works.
select * from public.publish_free_catalog_works(array[
  'ws-q2977508',
  'han-dislande',
  'hernani',
  'lhomme-qui-rit-2',
  'le-dernier-jour-dun-condamn',
  'le-roi-samuse',
  'ws-q3265982',
  'quatrevingt-treize-2',
  'ruy-blas-drame',
  'ws-q3231195'
]);

-- Jules Verne: complete/single-work records with DE-PD ready content.
select * from public.publish_free_catalog_works(array[
  'autour-de-la-lune',
  'aventures-du-capitaine-hatteras',
  'cinq-semaines-en-ballon',
  'l-le-myst-rieuse',
  'les-enfants-du-capitaine-grant',
  'vingt-mille-lieues-sous-les-mers-complete',
  'le-docteur-ox',
  'une-ville-flottante',
  'la-jangada-huit-cent-lieues-sur-lamazone',
  'face-au-drapeau'
]);

-- Shakespeare: existing Hamlet/Romeo were already published; this wave adds
-- ten more complete DE-PD editions (some are French translations whose
-- translator rights have already cleared the DE rights gate).
select * from public.publish_free_catalog_works(array[
  'macbeth',
  'othello',
  'le-roi-lear',
  'la-temp-te',
  'le-songe-dune-nuit-d-t',
  'le-marchand-de-venise',
  'jules-c-sar',
  'antoine-et-cl-op-tre',
  'beaucoup-de-bruit-pour-rien',
  'comme-il-vous-plaira'
]);

-- Dickens: only clean single-work LoC records were published. Combined
-- volumes/anthologies such as "Great expectations and Hard times" remain out.
select * from public.publish_free_catalog_works(array[
  'the-personal-history-of-david-copperfield-loc',
  'our-mutual-friend-loc',
  'a-child-s-history-of-england-loc'
]);

-- Editorial display cleanup for Wikisource disambiguation suffixes. Preserve
-- old source-shaped titles in alternative_titles so search/identity history is
-- not lost.
with cleaned as (
  select id,
         title old_title,
         regexp_replace(title, '\s+\((Достоевский|Толстой)\)$', '', 'g') new_title
  from public.works
  where author_id in ('dostoevsky','tolstoy')
    and title ~ '\s+\((Достоевский|Толстой)\)$'
)
update public.works w
set title = c.new_title,
    original_title = case when w.original_title = c.old_title then c.new_title else w.original_title end,
    alternative_titles = case
      when not (c.old_title = any(coalesce(w.alternative_titles,'{}'::text[])))
        then array_append(coalesce(w.alternative_titles,'{}'::text[]), c.old_title)
      else w.alternative_titles
    end
from cleaned c
where w.id = c.id;

-- Cleanup for the three Dickens LoC display titles published in this wave.
with fixes(id,new_title) as (values
  ('a-child-s-history-of-england-loc','A Child''s History of England'),
  ('our-mutual-friend-loc','Our Mutual Friend'),
  ('the-personal-history-of-david-copperfield-loc','The Personal History of David Copperfield')
), old as (
  select w.id,w.title old_title,f.new_title
  from public.works w
  join fixes f on f.id=w.id
)
update public.works w
set title=o.new_title,
    original_title=case when w.original_title=o.old_title then o.new_title else w.original_title end,
    alternative_titles=case
      when not (o.old_title = any(coalesce(w.alternative_titles,'{}'::text[])))
        then array_append(coalesce(w.alternative_titles,'{}'::text[]),o.old_title)
      else w.alternative_titles
    end
from old o
where w.id=o.id;
