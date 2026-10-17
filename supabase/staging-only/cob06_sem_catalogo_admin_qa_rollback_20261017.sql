-- ROLLBACK STAGING COB-06: apenas a RPC nova sem catalogo criada para QA em 17/10/2026.
-- Revisar ausencia de dependencias antes de executar. Nao usar em producao.
BEGIN;
DROP FUNCTION IF EXISTS public.catalogo_arquivar_sem_catalogo_admin(text,uuid);
COMMIT;
