import test from "node:test";
import assert from "node:assert/strict";
import { parseStorageObjectReference, storageObjectKey, STORAGE_BUCKETS } from "../supabase/functions/storage-cleanup/storage-path-utils.mjs";

test("reconhece caminho de objeto do catálogo sem misturar bucket e prefixo", () => {
  assert.deepEqual(parseStorageObjectReference("catalogos/vagao-lanches/prod-1/foto.webp"), {
    bucket_id: "catalogos",
    object_name: "vagao-lanches/prod-1/foto.webp",
  });
});

test("reconhece URL pública do Storage e decodifica espaços", () => {
  assert.deepEqual(parseStorageObjectReference("https://example.supabase.co/storage/v1/object/public/catalogos/loja/prod/foto%20nova.webp"), {
    bucket_id: "catalogos",
    object_name: "loja/prod/foto nova.webp",
  });
});

test("recusa bucket desconhecido, URL externa e path traversal", () => {
  assert.equal(parseStorageObjectReference("cadastros/loja/foto.png")?.bucket_id, "cadastros");
  assert.equal(parseStorageObjectReference("https://example.com/foto.png"), null);
  assert.equal(parseStorageObjectReference("catalogos/loja/../segredo.png"), null);
  assert.equal(parseStorageObjectReference("outro-bucket/loja/foto.png"), null);
});

test("key e lista de buckets refletem a retenção atual", () => {
  assert.equal(storageObjectKey("catalogos/loja/prod/foto.webp"), "catalogos/loja/prod/foto.webp");
  assert.deepEqual(STORAGE_BUCKETS, ["cadastros", "mural-imagens", "catalogos"]);
});
