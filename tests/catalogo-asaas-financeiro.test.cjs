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



test("reconciliação após timeout não reemite cobranças nem Pix", () => {
  assert.match(edge, /const novoClaim=!claimError&&Boolean\(claim\)/);
  assert.match(edge, /if\(!payment&&!novoClaim\)/);
  assert.match(edge, /if\(candidates.length>1\)/);
  assert.match(edge, /if\(!payment\)\{/);
  assert.match(edge, /if\(alreadyPaid\)await verifyInvoice/);
});

test("administrador pode conciliar transferência apenas por GET, sem novo pagamento", () => {
  const admin = read("js/entregas-operacao.js");
  assert.match(edge, /async function reconcileAdminTransfer\(uid:string,body:Record/);
  assert.match(edge, /const transfer=await asaas\("\/transfers\/"\+encodeURIComponent\(transferId\)\)/);
  assert.match(edge, /transfer.externalReference===saqueId/);
  assert.match(edge, /cents\(transfer.value\)===Number\(row.valor_centavos\)/);
  assert.match(admin, /"conciliar_saque_admin"/);
  assert.match(admin, /sem criar transferência/);
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

const validationSQL = read("supabase/pending-migrations/20261009100000_asaas_validacao_saque_webhook.sql");

test("webhook de autorização isolado, exclusivo sandbox e recusando por padrão", () => {
 assert.match(edge, /ASAAS_SAQUE_VALIDACAO_TOKEN/);
 assert.match(edge, /ASAAS_SAQUE_VALIDACAO_ENABLED/);
 assert.match(edge, /ENVIRONMENT!=="sandbox"/);
 assert.match(edge, /pathname\.endsWith\("\/saque-autorizacao"\)/);
 assert.match(edge, /pathname\.endsWith\("\/webhook"\)/);
 assert.match(edge, /body\.type!=="TRANSFER"/);
 assert.match(edge, /return approveResponse\("REFUSED"/);
 assert.match(edge, /equalSecret\(actual,WITHDRAWAL_AUTH_TOKEN\)/);
});

test("aprovação compara ID, valor, destino e créditos com a API do Asaas", () => {
 assert.match(edge, /crypto\.subtle\.sign\("HMAC"/);
 assert.match(edge, /pix_destino_sha256/);
 assert.match(edge, /if\(unique\.length===0\)return false/);
 assert.match(edge, /await pixDestinationsMatch/);
 assert.match(edge, /remote\.externalReference===ref/);
 assert.match(edge, /cents\(remote\.value\)===localAmount/);
 assert.match(edge, /saque\.transferencia_id!==id/);
 assert.match(edge, /r\.financiamento_comprovado===true/);
 assert.match(edge, /sum===localAmount/);
});

test("auditabilidade idempotente sem acesso público ou destruição do histórico", () => {
 assert.match(validationSQL, /ADD COLUMN IF NOT EXISTS pix_destino_sha256/);
 assert.match(validationSQL, /CREATE TABLE IF NOT EXISTS public\.catalogo_asaas_validacoes_saque/);
 assert.match(validationSQL, /PRIMARY KEY \(saque_id, transferencia_id\)/);
 assert.match(validationSQL, /ENABLE ROW LEVEL SECURITY/);
 assert.match(validationSQL, /REVOKE ALL ON public\.catalogo_asaas_validacoes_saque/);
 assert.match(edge, /if\(existing\)return approveResponse/);
 assert.match(edge, /if\(insertError\?\.code==="23505"\)/);
 assert.doesNotMatch(validationSQL, /TRUNCATE|DROP TABLE|DELETE FROM/i);
});


test("validação pode testar token com pagamentos de saída bloqueados; transferência buscada por ID", () => {
 assert.match(edge, /if\(!PAYOUTS_ON\)return approveResponse\("REFUSED"/);
 assert.match(edge, /equalSecret\(actual,WITHDRAWAL_AUTH_TOKEN\)/);
 assert.match(edge, /\.eq\("transferencia_id",id\)\.maybeSingle\(\)/);
 assert.match(edge, /const ref=String\(saque\.id\)/);
 assert.match(edge, /payloadRef && payloadRef!==saque\.id/);
});

test("com payouts off somente GET autenticado concilia saques antigos sem criar outros", () => {
 assert.match(edge, /if\(path\.startsWith\("\/transfers"\) && method==="GET"\)/);
 assert.match(edge, /else enabled\(path\.startsWith\("\/transfers"\)\?"payouts":"billing"\)/);
 assert.match(edge, /for\(const row of pending\|\|\[\]\)/);
 assert.match(edge, /await reconcileTransfer\(String\(row\.id\),String\(row\.transferencia_id\)\)/);
 assert.match(edge, /async function withdraw\(uid:string\)\{\s*enabled\("payouts"\)/);
 assert.match(edge, /if\(status==="DONE"\)/);
 assert.match(edge, /if\(\["FAILED","CANCELLED"\]\.includes\(status\)\)/);
});


test("fingerprint HMAC SHA-256 tem hash explícito e é calculado antes da reserva", async () => {
 assert.match(edge, /crypto\.subtle\.importKey\("raw",keyBytes,\{name:"HMAC",hash:"SHA-256"\},false,\["sign"\]\)/);
 const before = edge.slice(edge.indexOf("async function withdraw(uid:string)"),edge.indexOf("const ADMIN_USER_ID"));
 assert.ok(before.indexOf("const destinationHash=await pixFingerprint") < before.indexOf('catalogo_asaas_reservar_saque'));
 assert.ok(before.indexOf("p_estado:\"falhou\"") < before.indexOf('transfer=await asaas("/transfers","POST"'));
 // O algoritmo é executável com WebCrypto, não apenas um token nominal.
 const { webcrypto } = require("node:crypto");
 const k = await webcrypto.subtle.importKey(
   "raw",new Uint8Array(32).fill(10),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const sig = new Uint8Array(await webcrypto.subtle.sign("HMAC",k,new TextEncoder().encode("guia-asaas-pix-v1:EVP:abc")));
 assert.equal(sig.length,32);
});


test("repasse confirmado via API registra operador automático sem atribuir falsamente ao motoboy", () => {
 const sqlAuto = read("supabase/pending-migrations/20261009120000_asaas_repasse_automatico_registrador.sql");
 assert.match(sqlAuto, /ALTER COLUMN registrado_por DROP NOT NULL/);
 assert.match(sqlAuto, /ADD CONSTRAINT catalogo_repasses_v2_registro_automatico_check/);
 assert.match(sqlAuto, /registrado_por IS NOT NULL OR/);
 assert.match(sqlAuto, /metadata->>'origem' = 'asaas_pix_automatico'/);
 assert.match(sqlAuto, /metadata->>'confirmacao' = 'consulta_asaas_DONE'/);
 assert.match(sqlAuto, /metadata->>'transferencia_id' = substr\(referencia, 7\)/);
 assert.match(sqlAuto, /INSERT INTO public\.catalogo_repasses_v2\(motoboy_id,valor_centavos,referencia,comprovante,registrado_por,metadata\)/);
 assert.match(sqlAuto, /'Pix confirmado pela API Asaas',NULL/);
 assert.match(sqlAuto, /'saque_asaas_id',v\.id/);
 assert.match(sqlAuto, /GET DIAGNOSTICS v_atualizados=ROW_COUNT/);
 assert.match(sqlAuto, /IF v_atualizados<>v_qtd THEN RAISE EXCEPTION/);
 assert.match(sqlAuto, /REVOKE ALL ON FUNCTION public\.catalogo_asaas_atualizar_saque/);
 assert.doesNotMatch(sqlAuto, /TRUNCATE|DELETE FROM public\.catalogo_/i);
});
