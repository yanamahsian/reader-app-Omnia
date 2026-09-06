import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Internal editorial tool: assembles several already-ingested, already-cleared
// public-domain volume editions into ONE canonical AN.KI edition.
//
// It never publishes a Work. Publication remains a separate call to the
// fail-closed publish_free_catalog_works RPC after work_readiness is verified.
// Every constituent edition must:
//   * exist and be ingestion_status=ready;
//   * belong to a Work by the same author as the target Work;
//   * be in the same language;
//   * have a ready normalized anki-json file;
//   * have public-domain rights in DE.
//
// The generated edition records its component editions in edition_components
// and receives only the intersection of public-domain jurisdictions shared by
// all components. No rights are inferred from author age alone here.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

type NormalizedChapter = { title: string | null; text: string };
type NormalizedDocument = {
  formatVersion: number;
  hasRealChapters: boolean;
  chapters: NormalizedChapter[];
};

type EditionRow = {
  id: string;
  work_id: string;
  language: string;
  is_original: boolean | null;
  translator_name: string | null;
  ingestion_status: string;
};

type WorkRow = {
  id: string;
  title: string;
  author_id: string;
  original_language: string | null;
  available_languages: string[] | null;
};

function parseNormalized(raw: string, editionId: string): NormalizedDocument {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Normalized JSON is invalid for ${editionId}`);
  }
  const doc = value as Partial<NormalizedDocument>;
  if (doc.formatVersion !== 1 || !Array.isArray(doc.chapters) || doc.chapters.length === 0) {
    throw new Error(`Unsupported normalized document shape for ${editionId}`);
  }
  const chapters: NormalizedChapter[] = doc.chapters.map((chapter, i) => {
    const c = chapter as Partial<NormalizedChapter>;
    if (typeof c.text !== "string") throw new Error(`Chapter ${i + 1} has no text in ${editionId}`);
    return { title: typeof c.title === "string" && c.title.trim() ? c.title.trim() : null, text: c.text };
  });
  const textLength = chapters.reduce((n, c) => n + c.text.trim().length, 0);
  if (textLength < 1000) throw new Error(`Normalized content is implausibly short for ${editionId}`);
  return { formatVersion: 1, hasRealChapters: Boolean(doc.hasRealChapters), chapters };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const token = req.headers.get("x-omnia-run-token") ?? url.searchParams.get("token") ?? "";
  const targetWorkId = (url.searchParams.get("targetWorkId") ?? "").trim();
  const rawSourceIds = (url.searchParams.get("sourceEditionIds") ?? "").split(",").map(x => x.trim()).filter(Boolean);
  const sourceEditionIds = Array.from(new Set(rawSourceIds));

  if (!token || !targetWorkId || sourceEditionIds.length < 2) {
    return json({ error: "Missing token, targetWorkId, or at least two sourceEditionIds" }, 400);
  }
  if (sourceEditionIds.length !== rawSourceIds.length) return json({ error: "Duplicate sourceEditionIds are not allowed" }, 400);
  if (sourceEditionIds.length > 12) return json({ error: "At most 12 source editions may be merged in one call" }, 400);

  const base = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !serviceRoleKey) return json({ error: "Missing server secrets" }, 500);
  const supabase = createClient(base, serviceRoleKey);

  const tokenHash = await sha256Hex(token);
  const { data: runToken } = await supabase
    .from("master_corpus_run_tokens")
    .select("id,expires_at,remaining_calls")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!runToken || new Date(runToken.expires_at).getTime() <= Date.now() || runToken.remaining_calls <= 0) {
    return json({ error: "Invalid, expired, or exhausted token" }, 401);
  }
  await supabase
    .from("master_corpus_run_tokens")
    .update({ remaining_calls: runToken.remaining_calls - 1, last_used_at: new Date().toISOString() })
    .eq("id", runToken.id)
    .eq("remaining_calls", runToken.remaining_calls);

  try {
    const { data: target, error: targetError } = await supabase
      .from("works")
      .select("id,title,author_id,original_language,available_languages")
      .eq("id", targetWorkId)
      .maybeSingle();
    if (targetError || !target) throw new Error(targetError?.message ?? `Target Work not found: ${targetWorkId}`);
    const targetWork = target as WorkRow;

    const { data: editionRows, error: editionsError } = await supabase
      .from("editions")
      .select("id,work_id,language,is_original,translator_name,ingestion_status")
      .in("id", sourceEditionIds);
    if (editionsError) throw new Error(editionsError.message);
    if ((editionRows ?? []).length !== sourceEditionIds.length) throw new Error("One or more source editions do not exist");
    const byEdition = new Map((editionRows as EditionRow[]).map(e => [e.id, e]));
    const orderedEditions = sourceEditionIds.map(id => byEdition.get(id)!);
    if (orderedEditions.some(e => e.ingestion_status !== "ready")) throw new Error("Every source edition must be ready");

    const languages = new Set(orderedEditions.map(e => e.language));
    if (languages.size !== 1) throw new Error("All source editions must use the same language");
    const language = orderedEditions[0].language;
    if (targetWork.original_language && targetWork.original_language !== language) {
      throw new Error(`Source language ${language} does not match target original_language ${targetWork.original_language}`);
    }

    const sourceWorkIds = Array.from(new Set(orderedEditions.map(e => e.work_id)));
    const { data: sourceWorks, error: sourceWorksError } = await supabase
      .from("works")
      .select("id,title,author_id,original_language,available_languages")
      .in("id", sourceWorkIds);
    if (sourceWorksError) throw new Error(sourceWorksError.message);
    if ((sourceWorks ?? []).length !== sourceWorkIds.length) throw new Error("One or more source Works are missing");
    const sourceWorkById = new Map((sourceWorks as WorkRow[]).map(w => [w.id, w]));
    if (orderedEditions.some(e => sourceWorkById.get(e.work_id)?.author_id !== targetWork.author_id)) {
      throw new Error("Every component Work must have the same author as the target Work");
    }

    const { data: normalizedFiles, error: filesError } = await supabase
      .from("book_files")
      .select("id,edition_id,storage_path")
      .in("edition_id", sourceEditionIds)
      .eq("kind", "normalized")
      .eq("format", "anki-json")
      .eq("ingestion_status", "ready");
    if (filesError) throw new Error(filesError.message);
    const fileByEdition = new Map((normalizedFiles ?? []).map((f: any) => [f.edition_id as string, f]));
    if (sourceEditionIds.some(id => !fileByEdition.has(id))) throw new Error("Every source edition must have a ready normalized anki-json file");

    const { data: rightsRows, error: rightsError } = await supabase
      .from("rights_assertions")
      .select("edition_id,status,jurisdiction")
      .in("edition_id", sourceEditionIds)
      .eq("status", "public-domain");
    if (rightsError) throw new Error(rightsError.message);

    const jurisdictionsByEdition = new Map<string, Set<string>>();
    for (const id of sourceEditionIds) jurisdictionsByEdition.set(id, new Set());
    for (const row of rightsRows ?? []) {
      if (typeof row.jurisdiction === "string" && row.jurisdiction) jurisdictionsByEdition.get(row.edition_id)?.add(row.jurisdiction);
    }
    if (sourceEditionIds.some(id => !jurisdictionsByEdition.get(id)?.has("DE"))) {
      throw new Error("Every source edition must already be public-domain in DE");
    }

    let commonJurisdictions = new Set(jurisdictionsByEdition.get(sourceEditionIds[0]) ?? []);
    for (const id of sourceEditionIds.slice(1)) {
      const next = jurisdictionsByEdition.get(id) ?? new Set<string>();
      commonJurisdictions = new Set([...commonJurisdictions].filter(x => next.has(x)));
    }
    if (!commonJurisdictions.has("DE")) throw new Error("DE is not in the common rights intersection");

    const mergedChapters: NormalizedChapter[] = [];
    const componentLabels: string[] = [];
    for (let i = 0; i < sourceEditionIds.length; i++) {
      const editionId = sourceEditionIds[i];
      const edition = byEdition.get(editionId)!;
      const componentWork = sourceWorkById.get(edition.work_id)!;
      const label = componentWork.title;
      componentLabels.push(label);
      const file = fileByEdition.get(editionId)! as any;
      const { data: blob, error: downloadError } = await supabase.storage.from("book-files").download(file.storage_path);
      if (downloadError || !blob) throw new Error(`Failed to download ${editionId}: ${downloadError?.message ?? "no blob"}`);
      const doc = parseNormalized(await blob.text(), editionId);
      if (doc.hasRealChapters && doc.chapters.length > 1) {
        for (const chapter of doc.chapters) {
          mergedChapters.push({
            title: chapter.title ? `${label} — ${chapter.title}` : label,
            text: chapter.text
          });
        }
      } else {
        const text = doc.chapters.map(c => c.text).join("\n\n");
        mergedChapters.push({ title: label, text });
      }
    }

    const mergedTextLength = mergedChapters.reduce((n, c) => n + c.text.length, 0);
    if (mergedTextLength < 20000) throw new Error(`Merged content is implausibly short (${mergedTextLength} chars)`);

    const normalizedDocument: NormalizedDocument = {
      formatVersion: 1,
      hasRealChapters: true,
      chapters: mergedChapters
    };
    const normalizedJson = JSON.stringify(normalizedDocument);
    const sourceText = mergedChapters.map(c => `${c.title ?? ""}\n\n${c.text}`).join("\n\n");
    const editionId = `${targetWorkId}-composite-v1`;
    const normalizedPath = `normalized/${editionId}/content.json`;
    const sourcePath = `sources/composite/${targetWorkId}/v1/original.txt`;
    const allOriginal = orderedEditions.every(e => e.is_original === true && !e.translator_name);

    const { error: editionError } = await supabase.from("editions").upsert({
      id: editionId,
      work_id: targetWorkId,
      language,
      is_original: allOriginal ? true : null,
      translator_name: null,
      source_id: "anki-composite",
      external_id: `${targetWorkId}:v1`,
      ingestion_status: "processing"
    }, { onConflict: "id" });
    if (editionError) throw new Error(`Edition upsert: ${editionError.message}`);

    const sourceUpload = await supabase.storage.from("book-files").upload(sourcePath, sourceText, {
      contentType: "text/plain; charset=utf-8",
      upsert: true
    });
    if (sourceUpload.error) throw new Error(`Source upload: ${sourceUpload.error.message}`);
    const normalizedUpload = await supabase.storage.from("book-files").upload(normalizedPath, normalizedJson, {
      contentType: "application/json",
      upsert: true
    });
    if (normalizedUpload.error) throw new Error(`Normalized upload: ${normalizedUpload.error.message}`);

    await supabase.from("rights_assertions").delete().eq("edition_id", editionId);
    await supabase.from("book_files").delete().eq("edition_id", editionId);
    await supabase.from("edition_components").delete().eq("edition_id", editionId);

    const { data: insertedFiles, error: insertFilesError } = await supabase.from("book_files").insert([
      {
        edition_id: editionId,
        kind: "source",
        format: "plaintext",
        storage_path: sourcePath,
        byte_size: new TextEncoder().encode(sourceText).byteLength,
        ingestion_status: "ready"
      },
      {
        edition_id: editionId,
        kind: "normalized",
        format: "anki-json",
        storage_path: normalizedPath,
        byte_size: new TextEncoder().encode(normalizedJson).byteLength,
        checksum: await sha256Hex(normalizedJson),
        ingestion_status: "ready"
      }
    ]).select();
    if (insertFilesError || !insertedFiles) throw new Error(`book_files insert: ${insertFilesError?.message ?? "no rows"}`);
    const normalizedFile = insertedFiles.find((f: any) => f.kind === "normalized");
    if (!normalizedFile) throw new Error("Normalized file row missing after insert");

    const { error: componentsError } = await supabase.from("edition_components").insert(
      sourceEditionIds.map((componentEditionId, i) => ({
        edition_id: editionId,
        position: i + 1,
        component_edition_id: componentEditionId,
        label: componentLabels[i]
      }))
    );
    if (componentsError) throw new Error(`edition_components insert: ${componentsError.message}`);

    const { error: rightsInsertError } = await supabase.from("rights_assertions").insert(
      [...commonJurisdictions].sort().map(jurisdiction => ({
        edition_id: editionId,
        book_file_id: normalizedFile.id,
        status: "public-domain",
        jurisdiction,
        rights_metadata: {
          assessment: "constituent-editions-all-public-domain",
          component_edition_ids: sourceEditionIds,
          component_labels: componentLabels,
          rule: "jurisdiction must be public-domain on every constituent edition",
          computed_by: "omnia-merge-public-domain-volumes"
        }
      }))
    );
    if (rightsInsertError) throw new Error(`rights_assertions insert: ${rightsInsertError.message}`);

    const langs = Array.isArray(targetWork.available_languages) ? targetWork.available_languages : [];
    if (!langs.includes(language)) {
      await supabase.from("works").update({ available_languages: [...langs, language] }).eq("id", targetWorkId);
    }
    await supabase.from("editions").update({ ingestion_status: "ready" }).eq("id", editionId);

    return json({
      ok: true,
      targetWorkId,
      editionId,
      sourceEditionIds,
      componentLabels,
      language,
      isOriginal: allOriginal,
      commonPublicDomainJurisdictions: [...commonJurisdictions].sort(),
      chapters: mergedChapters.length,
      textLength: mergedTextLength,
      normalizedBytes: new TextEncoder().encode(normalizedJson).byteLength
    });
  } catch (error) {
    return json({
      ok: false,
      targetWorkId,
      sourceEditionIds,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
