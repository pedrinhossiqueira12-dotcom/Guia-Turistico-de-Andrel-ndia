// Regressões estáticas do módulo financeiro Asaas (sem credenciais nem transferências reais).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (name) => fs.readFileSync(name, "utf8");
const sql = read("supabase/pending-migrations/20261008180000_asaas_faturas_saques_controlados.sql");
const edge = read("supabase/functions/catalogo-asaas-financeiro/index.ts");
const courier = read("js/motoboy.js");
const courierHtml = read("pages/motoboy.html");
const merchant = read("js/catalogo-admin.js");
const merchantHtml = read("pages/catalogo-admin.html");

test("migração é aditiva e protege o histórico financeiro", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.catalogo_asaas_saques/);
  assert.match(sql, /catalogo_asaas_saque_credito_ativo_uq/);
  assert.match(sql, /WHERE ativo;/);
  assert.match(sql, /ALTER TABLE public\.catalogo_asaas_saques ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.catalogo_asaas_clientes/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE|DELETE FROM public\.catalogo_(?:remuneracoes|pedidos|comissoes)/i);
  assert.match(sql, /b\.gateway='asaas' AND b\.status='pago'/);
  assert.match(sql, /r\.status='disponivel'/);
});

test("toda movimentação externa é opcional e secrets não vão ao browser", () => {
  assert.match(edge, /ASAAS_BILLING_ENABLED/);
  assert.match(edge, /ASAAS_PAYOUTS_ENABLED/);
  assert.match(edge, /=== "true"/);
  assert.match(edge, /db\.auth\.getUser\(token\)/);
  assert.match(edge, /ASAAS_API_KEY/);
  assert.match(edge, /asaas-access-token/);
  assert.doesNotMatch(courier+merchant, /ASAAS_API_KEY|ASAAS_WEBHOOK_TOKEN/);
});

test("somente status bancário DONE conclui saque e créditos são reservados", () => {
  assert.match(edge, /if\(status==="DONE"\)/);
  assert.match(edge, /catalogo_asaas_reservar_saque/);
  assert.match(edge, /externalReference:saqueId/);
  assert.match(edge, /get\("authorization"\)/);
  assert.match(sql, /v_credito\.repasse_id IS NOT NULL/);
  assert.match(sql, /IF v_total IS NULL OR v_total<=0/);
});

test("repasse antigo não pode consumir remuneração reservada ao Asaas", () => {
  assert.match(sql, /CREATE TRIGGER catalogo_asaas_reserva_guard/);
  assert.match(sql, /IF NEW.status<>'pago' OR NEW.repasse_id IS NULL/);
  assert.match(sql, /v_repasse_saque IS DISTINCT FROM v_reserva::text/);
  assert.match(sql, /GET DIAGNOSTICS v_atualizados=ROW_COUNT/);
  assert.match(sql, /IF v_atualizados<>v_qtd THEN RAISE EXCEPTION/);
});

test("auditoria administrativa não executa transferências", () => {
  const adminHtml = read("pages/entregas-operacao.html");
  const adminJs = read("js/entregas-operacao.js");
  assert.match(edge, /case "listar_saques_admin":return await listAdminPayouts\(user.id\)/);
  assert.match(edge, /if\(uid!==ADMIN_USER_ID\)throw new Failure/);
  assert.match(adminHtml, /id="listaSaquesAsaas"/);
  assert.match(adminJs, /chamarApi\("listar_saques_admin"/);
});


test("telas antigas preservadas e opção de saque aparece apenas quando liberada", () => {
  assert.match(courierHtml, /id="motoboyWithdrawPix"[^>]*disabled/);
  assert.match(courierHtml, /id="motoboyPixKey"/);
  assert.match(courier, /!carteira\.saque_habilitado/);
  assert.match(courier, /API_URL/);
  assert.match(merchantHtml, /id="faturaAsaasDocumento"/);
  assert.match(merchant, /invoke\("catalogo-asaas-financeiro"/);
  assert.match(merchantHtml, /id="competenciaOffline"/);
});
