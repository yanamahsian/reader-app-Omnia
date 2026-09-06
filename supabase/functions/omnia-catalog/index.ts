import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Public startup catalog. It deliberately returns only the curated Free
// corpus; paid discovery is handled by omnia-library-catalog after user
// identity/plan resolution.
//
// IMPORTANT: source rows come from a single JSON-returning RPC rather than
// unpaginated PostgREST table selects. The production PostgREST row cap may
// be much smaller than the catalog (it was 10 when this bug was found), so
// direct .select("*") calls silently truncated the startup catalog.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey"
};

const BOOK_CONTENT_ENDPOINT = "https://prknybetxirzbzkvmovw.supabase.co/functions/v1/omnia-book-content";

interface WorkRow {
  id: string;
  title: string;
  original_title: string | null;
  alternative_titles: string[];
  author_id: string;
  original_language: string;
  description: string | null;
  cover: string | null;
  publication_year: number | null;
  available_languages: string[];
  country_id: string | null;
  century_id: string | null;
  epoch_id: string | null;
  movement_id: string | null;
  genre_ids: string[];
  theme_ids: string[];
  collection_ids: string[];
  publication_status: string;
}

interface AuthorRow {
  id: string;
  name: string;
  alternative_names: string[];
  birth_year: number | null;
  death_year: number | null;
}

interface EditionRow {
  id: string;
  work_id: string;
  language: string;
  is_original: boolean | null;
  translator_name: string | null;
  ingestion_status: string;
}

interface BookFileRow {
  id: string;
  edition_id: string;
  kind: string;
  format: string;
  ingestion_status: string;
}

interface RightsRow {
  edition_id: string;
  status: string;
  jurisdiction: string | null;
}

interface CatalogPayload {
  works?: WorkRow[];
  authors?: AuthorRow[];
  editions?: EditionRow[];
  files?: BookFileRow[];
  rights?: RightsRow[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response("Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY", { status: 500, headers: CORS_HEADERS });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data, error } = await supabase.rpc("get_free_startup_catalog_data");
    if (error) {
      console.error("omnia-catalog: catalog RPC failed", error);
      return new Response(`Failed to build catalog: ${error.message}`, { status: 500, headers: CORS_HEADERS });
    }

    const payload = (data ?? {}) as CatalogPayload;
    const works = Array.isArray(payload.works) ? payload.works : [];
    const authors = Array.isArray(payload.authors) ? payload.authors : [];
    const editions = Array.isArray(payload.editions) ? payload.editions : [];
    const files = Array.isArray(payload.files) ? payload.files : [];
    const rights = Array.isArray(payload.rights) ? payload.rights : [];

    const authorById = new Map(authors.map(author => [author.id, author]));

    const rightsByEdition = new Map<string, RightsRow[]>();
    for (const right of rights) {
      const list = rightsByEdition.get(right.edition_id) ?? [];
      list.push(right);
      rightsByEdition.set(right.edition_id, list);
    }

    const readyFilesByEdition = new Map<string, BookFileRow[]>();
    for (const file of files) {
      if (file.ingestion_status !== "ready") continue;
      const list = readyFilesByEdition.get(file.edition_id) ?? [];
      list.push(file);
      readyFilesByEdition.set(file.edition_id, list);
    }

    const editionsByWork = new Map<string, EditionRow[]>();
    for (const edition of editions) {
      const list = editionsByWork.get(edition.work_id) ?? [];
      list.push(edition);
      editionsByWork.set(edition.work_id, list);
    }

    const responseBooks = works.map(work => {
      const author = authorById.get(work.author_id);
      const workEditions = editionsByWork.get(work.id) ?? [];

      return {
        id: work.id,
        title: work.title,
        originalTitle: work.original_title,
        alternativeTitles: work.alternative_titles ?? [],
        authorId: work.author_id,
        authorName: author?.name ?? "",
        originalLanguage: work.original_language,
        availableLanguages: work.available_languages ?? [],
        publicationYear: work.publication_year,
        countryId: work.country_id,
        centuryId: work.century_id,
        epochId: work.epoch_id,
        movementId: work.movement_id,
        genreIds: work.genre_ids ?? [],
        themeIds: work.theme_ids ?? [],
        description: work.description ?? "",
        cover: work.cover,
        collectionIds: work.collection_ids ?? [],
        editions: workEditions.map(edition => ({
          id: edition.id,
          language: edition.language,
          isOriginal: edition.is_original,
          translatorName: edition.translator_name,
          rights: (rightsByEdition.get(edition.id) ?? []).map(r => ({ status: r.status, jurisdiction: r.jurisdiction })),
          sourceId: "gutenberg",
          externalIds: {},
          files: edition.ingestion_status === "ready"
            ? (readyFilesByEdition.get(edition.id) ?? []).map(file => ({
                format: file.format,
                url: `${BOOK_CONTENT_ENDPOINT}?editionId=${encodeURIComponent(edition.id)}`
              }))
            : []
        }))
      };
    });

    const referencedAuthorIds = new Set(works.map(work => work.author_id));
    const responseAuthors = authors
      .filter(author => referencedAuthorIds.has(author.id))
      .map(author => ({
        id: author.id,
        name: author.name,
        alternativeNames: author.alternative_names ?? [],
        birthYear: author.birth_year,
        deathYear: author.death_year
      }));

    return new Response(
      JSON.stringify({ books: responseBooks, authors: responseAuthors }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("omnia-catalog: unhandled exception", error);
    return new Response(
      `omnia-catalog failed: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
