import { createClient } from "npm:@supabase/supabase-js@2";
import { parseStorageObjectReference, STORAGE_BUCKETS } from "./storage-path-utils.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GITHUB_OWNER = "pedrinhossiqueira12-dotcom";
const GITHUB_REPOSITORY = "Guia-Turistico-de-Andrel-ndia";
const GITHUB_BRANCH = "main";
const BUCKETS = STORAGE_BUCKETS;

let serviceKey = "";
try {
  if (SUPABASE_SECRET_KEYS) {
    const parsed = JSON.parse(SUPABASE_SECRET_KEYS);
    serviceKey = parsed?.default || parsed?.service_role || "";
  }
} catch (error) {
  console.error("Unable to parse configured Supabase service key bundle.", String(error));
}
if (!serviceKey) serviceKey = SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !serviceKey) throw new Error("Required Supabase server configuration is missing.");
const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function addRecordReferences(target: Set<string>, record: any) {
  if (!record || String(record.status || "").trim().toLowerCase() === "deletado" || record.deletado_em) return;
  const values: any[] = [];
  for (const key of ["imagem", "imagem_url"]) if (typeof record[key] === "string") values.push(record[key]);
  if (Array.isArray(record.imagens)) values.push(...record.imagens);
  for (const value of values) {
    const object = parseStorageObjectReference(value);
    if (object) target.add(`${object.bucket_id}/${object.object_name}`);
  }
}

async function loadPublicJson(file: string) {
  const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/${GITHUB_BRANCH}/${file}`;
  const response = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`Public data fetch failed (${response.status}) for ${file}.`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(`Public data file is not an array: ${file}.`);
  return data;
}

async function readAll(table: string, columns: string) {
  const output: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw new Error(`Database read failed for ${table}: ${error.message}`);
    output.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return output;
}

async function collectReferences() {
  const [comercios, pessoas, cadastros, perfis, produtos] = await Promise.all([
    loadPublicJson("DATA/comercios.json"),
    loadPublicJson("DATA/pessoas.json"),
    readAll("cadastros_comercios", "status,imagem_url,imagens"),
    readAll("mural_cadastros", "status,imagem,imagens"),
    readAll("catalogo_produtos", "imagem,deletado_em"),
  ]);
  const references = new Set<string>();
  for (const list of [comercios, pessoas, cadastros, perfis, produtos]) {
    for (const row of list) addRecordReferences(references, row);
  }
  return references;
}

async function listBucketObjects(bucket: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(prefix: string) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Storage inventory failed for bucket ${bucket}: ${error.message}`);
      const entries = data || [];
      for (const entry of entries) {
        if (!entry?.name) continue;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null || entry.id === undefined) await walk(path);
        else output.push(path);
      }
      if (entries.length < 1000) break;
    }
  }
  await walk("");
  return output;
}

async function readQueue() {
  const output: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin.from("storage_cleanup_queue")
      .select("bucket_id,object_name,first_unreferenced_at,checks_count")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Retention queue read failed: ${error.message}`);
    output.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return output;
}

async function reconcile() {
  const [references, queueRows] = await Promise.all([collectReferences(), readQueue()]);
  const queue = new Map(queueRows.map((row) => [`${row.bucket_id}/${row.object_name}`, row]));
  const now = new Date();
  const timestamp = now.toISOString();
  let scanned = 0;
  let queuedNew = 0;
  let queuedRechecked = 0;
  let queueReleased = 0;
  let dueForReview = 0;

  for (const bucket of BUCKETS) {
    const objects = await listBucketObjects(bucket);
    for (const objectName of objects) {
      scanned++;
      const key = `${bucket}/${objectName}`;
      const existing = queue.get(key);
      if (references.has(key)) {
        if (existing) {
          const { error } = await admin.from("storage_cleanup_queue").delete()
            .eq("bucket_id", bucket).eq("object_name", objectName);
          if (error) throw new Error(`Queue release failed for a reused object: ${error.message}`);
          queue.delete(key);
          queueReleased++;
        }
        continue;
      }
      if (existing) {
        const { error } = await admin.from("storage_cleanup_queue").update({
          last_checked_at: timestamp,
          checks_count: Number(existing.checks_count || 0) + 1,
          last_error: null,
        }).eq("bucket_id", bucket).eq("object_name", objectName);
        if (error) throw new Error(`Queue refresh failed: ${error.message}`);
        queuedRechecked++;
        if (Date.parse(existing.first_unreferenced_at) <= now.getTime() - 7 * 24 * 60 * 60 * 1000) dueForReview++;
      } else {
        const { error } = await admin.from("storage_cleanup_queue").insert({
          bucket_id: bucket,
          object_name: objectName,
          first_unreferenced_at: timestamp,
          last_checked_at: timestamp,
          checks_count: 1,
        });
        if (error && error.code !== "23505") throw new Error(`Queue insert failed: ${error.message}`);
        queuedNew++;
      }
    }
  }
  return {
    success: true,
    dry_run: true,
    scanned_objects: scanned,
    newly_queued: queuedNew,
    rechecked: queuedRechecked,
    released_because_referenced: queueReleased,
    retention_window_days: 7,
    due_for_manual_review: dueForReview,
    permanent_storage_deletion_performed: false,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ success: false, error: "POST required." }, 405);
  const token = request.headers.get("x-cleanup-token") || "";
  if (token.length < 32) return json({ success: false, error: "Unauthorized." }, 401);
  const { data: authorized, error: authError } = await admin.rpc("is_storage_cleanup_authorized", { p_token: token });
  if (authError || authorized !== true) return json({ success: false, error: "Unauthorized." }, 401);
  try {
    const result = await reconcile();
    return json(result, 200);
  } catch (error) {
    console.error("Storage retention dry-run failed:", (error as Error).message);
    return json({ success: false, dry_run: true, permanent_storage_deletion_performed: false, error: "Reconciliation failed. See restricted function logs." }, 500);
  }
});
