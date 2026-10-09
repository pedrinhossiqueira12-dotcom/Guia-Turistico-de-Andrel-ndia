"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (name) => fs.readFileSync(name, "utf8").replace(/\r\n?/g,"\n");
const guard = read("supabase/pending-migrations/20261009183000_proteger_republicacao_legada_apos_encerramento.sql");
const closure = read("supabase/pending-migrations/20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql");
const oldGuard = read("supabase/pending-migrations/20261009163000_impedir_reabertura_encerramento.sql");

test("reativação legada exige verificação de qualquer encerramento, independentemente do status anterior", () => {
  assert.match(guard, /NEW\.status\s*=\s*'ativo'/);
  assert.match(guard, /e\.comercio_id\s*=\s*NEW\.local_id/);
  for (const stage of ["aguardando_quitacao","pendente_arquivamento","arquivado"])
    assert.match(guard, new RegExp("'" + stage + "'"));
  assert.doesNotMatch(guard, /OLD\.status\s*=\s*'arquivado'/);
});

test("o trigger intercepta UPDATE e INSERT, inclusive ON CONFLICT do webhook legado", () => {
  assert.match(guard, /BEFORE INSERT OR UPDATE OF status ON public\.comercios_publicados/);
  assert.match(guard, /EXECUTE FUNCTION catalogo_private\.catalogo_impedir_republicacao_encerrada\(\)/);
  assert.match(guard, /CREATE OR REPLACE FUNCTION catalogo_private\.catalogo_impedir_republicacao_encerrada\(\)/);
});

test("ordem de lock sincroniza republicação e início do encerramento", () => {
  assert.match(guard, /public\.catalogos[\s\S]*FOR UPDATE/);
  assert.match(closure, /FROM public\.catalogos[\s\S]*FOR UPDATE/);
});

test("despublicação com dívida continua bloqueada, sem exclusão do histórico", () => {
  assert.match(closure, /BEFORE DELETE OR UPDATE OF status ON public\.comercios_publicados/);
  assert.match(closure, /catalogo_pendencias_encerramento\(v_id\)/);
  assert.match(closure, /arquivamento negado/);
  assert.match(closure, /catalogo_proteger_exclusao_fisica/);
  assert.match(oldGuard, /catalogo_encerramento_sem_reabertura/);
});

test("migração não é ferramenta de pagamento ou exposição de dados", () => {
  assert.match(guard, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(guard, /REVOKE ALL ON FUNCTION catalogo_private\.catalogo_impedir_republicacao_encerrada\(\)/);
  assert.doesNotMatch(guard, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON public\./i);
  assert.doesNotMatch(guard, /http[s]?:|pix|transfers|asaas/i);
});
