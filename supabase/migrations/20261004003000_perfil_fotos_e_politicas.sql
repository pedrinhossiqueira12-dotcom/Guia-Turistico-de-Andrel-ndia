BEGIN;

-- Avatar privado por identidade, servido por URL pública somente após upload autenticado.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'perfil-fotos',
  'perfil-fotos',
  true,
  2097152,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS perfil_fotos_usuario_upload ON storage.objects;
CREATE POLICY perfil_fotos_usuario_upload
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'perfil-fotos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp')
  );

DROP POLICY IF EXISTS perfil_fotos_usuario_update ON storage.objects;
CREATE POLICY perfil_fotos_usuario_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'perfil-fotos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'perfil-fotos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp')
  );

DROP POLICY IF EXISTS perfil_fotos_usuario_delete ON storage.objects;
CREATE POLICY perfil_fotos_usuario_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'perfil-fotos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- A limpeza administrativa conhece o novo bucket sem tornar os objetos públicos por escrita.
ALTER TABLE public.storage_cleanup_queue
  DROP CONSTRAINT IF EXISTS storage_cleanup_queue_bucket_id_check;
ALTER TABLE public.storage_cleanup_queue
  ADD CONSTRAINT storage_cleanup_queue_bucket_id_check
  CHECK (bucket_id = ANY (ARRAY['cadastros','mural-imagens','catalogos','perfil-fotos']::text[]));

COMMIT;
