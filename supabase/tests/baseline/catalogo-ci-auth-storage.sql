-- Mocks mínimos para migrações SQL em PostgreSQL efêmero.
-- NUNCA executar em Supabase remoto nem em banco com tabelas preexistentes.
-- Exige catalogo_ci vazio, sessão com opt-in e schemas Auth/Storage ausentes.
DO $guard$
BEGIN
  IF current_database() <> 'catalogo_ci'
     OR current_setting('app.marketplace_test_auth_storage', true) IS DISTINCT FROM 'enabled'
     OR to_regnamespace('auth') IS NOT NULL
     OR to_regnamespace('storage') IS NOT NULL
     OR to_regclass('public.catalogos') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Mocks Auth/Storage exigem catalogo_ci vazio e opt-in explicito';
  END IF;
END $guard$;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth_ci$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$auth_ci$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION storage.extension(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $storage_extension_ci$
  SELECT split_part(p_name, '.', array_length(string_to_array(p_name, '.'), 1))
$storage_extension_ci$;
CREATE FUNCTION storage.foldername(p_name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $storage_folder_ci$
  SELECT (string_to_array(p_name, '/'))[1:greatest(array_length(string_to_array(p_name, '/'), 1) - 1, 0)]
$storage_folder_ci$;
