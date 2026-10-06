BEGIN;

-- Permite que um usuário autenticado envie seu próprio cadastro.
-- Não permite cadastro anônimo nem envio em nome de outro usuário.
DROP POLICY IF EXISTS cadastros_comercios_usuario_insert ON public.cadastros_comercios;
CREATE POLICY cadastros_comercios_usuario_insert
  ON public.cadastros_comercios
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = usuario_id);

COMMIT;
