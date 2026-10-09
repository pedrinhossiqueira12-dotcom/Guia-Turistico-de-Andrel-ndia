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
 const provaSQL=read("supabase/pending-migrations/20261009170000_asaas_saque_total_acumulado_sem_corte_registros.sql");
 assert.match(provaSQL, /AND r\.status='disponivel' AND r\.financiamento_comprovado/);
 assert.match(provaSQL, /AND v_elegiveis AND v_total=v_saque\.valor_centavos/);
 assert.match(edge, /prova\.elegivel===true/);
 assert.match(edge, /Number\(prova\.valor_centavos\)===localAmount/);
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
 const withdrawBlock=edge.slice(edge.indexOf("async function withdraw(uid:string)"),edge.indexOf("const ADMIN_USER_ID"));
 assert.match(withdrawBlock, /enabled\("payouts"\)/);
 assert.ok(withdrawBlock.indexOf('if(ENVIRONMENT!=="sandbox")') < withdrawBlock.indexOf('enabled("payouts")'));
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


const creditoPagoSQL=read("supabase/pending-migrations/20261009130000_asaas_protecao_credito_pago.sql");

test("reserva Asaas trava também reabertura e adulteração de crédito já pago", () => {
 assert.match(creditoPagoSQL, /CREATE OR REPLACE FUNCTION catalogo_private\.catalogo_asaas_proteger_credito_reservado\(\)/);
 assert.match(creditoPagoSQL, /IF OLD\.status='pago' THEN/);
 assert.match(creditoPagoSQL, /'Crédito de saque Asaas liquidado; alteração financeira proibida'/);
 assert.match(creditoPagoSQL, /IF NEW\.status<>'pago'/);
 assert.match(creditoPagoSQL, /NEW\.valor_centavos IS DISTINCT FROM OLD\.valor_centavos/);
 assert.match(creditoPagoSQL, /NEW\.motoboy_id IS DISTINCT FROM OLD\.motoboy_id/);
 assert.match(creditoPagoSQL, /NEW\.financiamento_comprovado IS DISTINCT FROM OLD\.financiamento_comprovado/);
 assert.match(creditoPagoSQL, /NEW\.metadata IS DISTINCT FROM OLD\.metadata/);
 assert.match(creditoPagoSQL, /v_repasse_saque IS DISTINCT FROM v_reserva::text/);
 assert.match(creditoPagoSQL, /BEFORE UPDATE ON public\.catalogo_remuneracoes_v2/);
 assert.match(creditoPagoSQL, /REVOKE ALL ON FUNCTION catalogo_private\.catalogo_asaas_proteger_credito_reservado/);
 assert.doesNotMatch(creditoPagoSQL, /DELETE FROM|TRUNCATE TABLE|DROP TABLE/i);
});

test("branch de homologação nunca envia transferência Asaas com ambiente production", () => {
 const withdrawBlock=edge.slice(edge.indexOf("async function withdraw(uid:string)"),edge.indexOf("const ADMIN_USER_ID"));
 assert.ok(withdrawBlock.includes('if(ENVIRONMENT!=="sandbox")'),"Saque precisa bloquear produção");
 assert.ok(withdrawBlock.indexOf('if(ENVIRONMENT!=="sandbox")') < withdrawBlock.indexOf('catalogo_asaas_reservar_saque'));
 assert.ok(withdrawBlock.indexOf('await requireTerms(uid,"motoboy","")') < withdrawBlock.indexOf('catalogo_asaas_reservar_saque'));
 assert.match(edge, /if\(method==="POST" && path==="\/transfers"\)\{/);
 assert.match(edge, /throw new Failure\("Transferência Pix de produção não está liberada\.",503\)/);
 assert.match(edge, /if\(ENVIRONMENT!=="sandbox" \|\| !WITHDRAWAL_AUTH_ON/);
});


test("saques exigem flags e token de autorização ativos antes de reserva e POST Asaas", () => {
 const withdraw=edge.slice(edge.indexOf("async function withdraw(uid:string)"),edge.indexOf("const ADMIN_USER_ID"));
 const network=edge.slice(edge.indexOf("async function asaas("),edge.indexOf("function competence("));
 const wallet=edge.slice(edge.indexOf("async function wallet("),edge.indexOf("async function reconcileTransfer("));
 assert.match(withdraw,/if\(!WITHDRAWAL_AUTH_ON \|\| WITHDRAWAL_AUTH_TOKEN\.length<32\)/);
 assert.ok(withdraw.indexOf("if(!WITHDRAWAL_AUTH_ON") < withdraw.indexOf('catalogo_asaas_reservar_saque'));
 assert.ok(withdraw.indexOf('enabled("payouts")') < withdraw.indexOf("if(!WITHDRAWAL_AUTH_ON"));
 assert.match(network,/if\(method==="POST" && path==="\/transfers"\)/);
 assert.match(network,/if\(!WITHDRAWAL_AUTH_ON \|\| WITHDRAWAL_AUTH_TOKEN\.length<32\)/);
 assert.match(wallet,/saque_habilitado:activeCourier&&ENVIRONMENT==="sandbox"&&PAYOUTS_ON&&WITHDRAWAL_AUTH_ON&&/);
 assert.match(wallet,/WITHDRAWAL_AUTH_TOKEN\.length>=32&&Boolean\(ASAAS_TOKEN\)/);
});


test("saque de R$ 100 e aceite versionado são exigidos pelo servidor", () => {
 const mig=read("supabase/pending-migrations/20261009150000_termos_cobranca_futura_encerramento_e_saque_minimo.sql");
 const pending=read("supabase/pending-migrations/20261009151000_carteira_pendencias_por_comercio.sql");
 const motoboy=read("js/motoboy.js");
 const merchant=read("js/catalogo-admin.js");
 const local=read("js/local.js");
 const closures=mig.slice(mig.indexOf("CREATE OR REPLACE FUNCTION public.catalogo_solicitar_encerramento_financeiro"));
 assert.match(mig,/v_total<10000/);
 assert.match(mig,/ORDER BY r\.id LIMIT 1000 FOR UPDATE OF r/);
 assert.match(mig,/CREATE TABLE IF NOT EXISTS public\.catalogo_aceites_operacionais/);
 assert.match(mig,/CREATE TABLE IF NOT EXISTS public\.catalogo_cobranca_preferencias/);
 assert.match(mig,/metodo text NOT NULL DEFAULT 'pix_manual'/);
 assert.match(mig,/status_autorizacao='autorizada'/);
 assert.match(mig,/ALTER TABLE public\.catalogo_aceites_operacionais ENABLE ROW LEVEL SECURITY/);
 assert.match(mig,/REVOKE ALL ON public\.catalogo_aceites_operacionais FROM PUBLIC,anon,authenticated/);
 assert.match(closures,/FOR UPDATE/);
 assert.match(closures,/divida_apurada_centavos/);
 assert.doesNotMatch(closures,/DELETE FROM public\.(?:catalogo_fatura|catalogo_comissoes|catalogo_remuneracoes)/);
 assert.match(pending,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_pendencias_motoboy/);
 assert.match(edge,/async function requireTerms\(uid:string,papel:string,store:string,allowInactiveMotoboy=false\)/);
 assert.match(edge,/case "aceitar_termos":return await acceptTerms/);
 assert.match(edge,/case "solicitar_encerramento":return await requestClosure/);
 assert.match(edge,/SAQUE_MINIMO_CENTAVOS=10000/);
 assert.match(edge,/metodo_cobranca:"pix_manual",pix_automatico_disponivel:false/);
 assert.match(motoboy,/motoboyTermsDialog/);
 assert.match(motoboy,/motoboyPendingByStore/);
 assert.match(merchant,/catalogoTermsDialog/);
 assert.match(merchant,/regularizarFaturaBloqueada/);
 assert.doesNotMatch(local,/acao:\s*"marcar_meu_comercio_deletado"/);
 assert.match(local,/acao:"solicitar_encerramento"/);
});


test("revisão residual: pedido privado abaixo de R$ 100 nunca cria transferência",()=>{
 const m=read("supabase/pending-migrations/20261009160000_solicitacoes_saldo_residual_motoboy.sql");
 const ui=read("js/motoboy.js");
 const html=read("pages/motoboy.html");
 assert.match(m,/saldo_snapshot_centavos BETWEEN 1 AND 9999/);
 assert.match(m,/WHERE status IN \('pendente','em_analise'\)/);
 assert.match(m,/ALTER TABLE public\.catalogo_asaas_saldos_residuais ENABLE ROW LEVEL SECURITY/);
 assert.match(m,/REVOKE ALL ON public\.catalogo_asaas_saldos_residuais FROM PUBLIC,anon,authenticated/);
 assert.match(edge,/case "solicitar_analise_residual":return await solicitarAnaliseResidual\(user\.id,body\)/);
 assert.match(edge,/case "listar_analises_residuais_admin":return await listarAnalisesResiduais\(user\.id\)/);
 const fn=edge.slice(edge.indexOf("async function solicitarAnaliseResidual("),edge.indexOf("async function reconcileTransfer("));
 assert.match(fn,/await requireTerms\(uid,"motoboy","",true\)/);
 assert.match(fn,/amount>0&&amount<SAQUE_MINIMO_CENTAVOS/);
 assert.match(fn,/\.insert\(\{motoboy_id:uid,saldo_snapshot_centavos:amount,motivo\}\)/);
 assert.doesNotMatch(fn,/asaas\("\/transfers"|catalogo_asaas_reservar_saque|catalogo_asaas_atualizar_saque/);
 assert.match(ui,/motoboyResidualForm/);
 assert.match(html,/id="motoboyResidualForm"/);
 assert.match(edge,/db\.rpc\("catalogo_asaas_validar_reserva_saque",\{p_saque:ref\}\)/);
 assert.doesNotMatch(edge,/const eligible=records\.length>0 && records\.length<=1000/);
});


test("encerramento auditado protege publicação, histórico e acesso à fatura",()=>{
 const sql=read("supabase/pending-migrations/20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql");
 const panel=read("js/admin-encerramentos.js");
 const html=read("pages/admin-encerramentos.html");
 const merchant=read("js/catalogo-admin.js");
 assert.match(sql,/CREATE OR REPLACE FUNCTION catalogo_private\.catalogo_pendencias_encerramento/);
 assert.match(sql,/p\.status NOT IN \('entregue','concluido','cancelado','reembolsado'\)/);
 assert.match(sql,/CREATE TRIGGER catalogo_publicacao_sem_divida_guard/);
 assert.match(sql,/BEFORE DELETE OR UPDATE OF status ON public\.comercios_publicados/);
 assert.match(sql,/CREATE TRIGGER catalogo_historico_guard_delete/);
 assert.match(sql,/BEFORE DELETE ON public\.catalogos/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.catalogo_finalizar_encerramento_financeiro/);
 assert.match(sql,/IF p_admin IS DISTINCT FROM/);
 assert.match(sql,/UPDATE public\.comercios_publicados SET status='arquivado'/);
 assert.doesNotMatch(sql,/DELETE FROM public\.(?:catalogo_|comercios_publicados)/);
 assert.match(edge,/case "listar_encerramentos_admin":return await listarEncerramentosAdmin\(user\.id\)/);
 assert.match(edge,/case "finalizar_encerramento_admin":return await finalizarEncerramentoAdmin\(user\.id,body\)/);
 assert.match(edge,/check\(body\.confirmacao===true/);
 assert.match(panel,/finalizar_encerramento_admin/);
 assert.match(html,/id="listaEncerramentos"/);
 assert.match(merchant,/Encerramento solicitado pelo proprietário/);
});


test("fatura anterior pode ser quitada sem novo aceite; novas vendas continuam protegidas",()=>{
 const invoice=edge.slice(edge.indexOf("async function createInvoice("),edge.indexOf("function pixDestination("));
 const merchant=read("js/catalogo-admin.js");
 const orders=read("supabase/functions/catalogo-pedidos-offline-admin/index.ts");
 assert.doesNotMatch(invoice,/await requireTerms\(uid,"comercio"/);
 assert.match(invoice,/enabled\("billing"\)/);
 assert.match(merchant,/const motivoFinanceiro=\["Comissão de pagamentos presenciais vencida\."/);
 assert.match(merchant,/!\(resultado\.bloqueado && motivoFinanceiro\)/);
 assert.match(orders,/await requireTermsForNewOrders\(userId,comercioId\)/);
});


test("saque multi-meses: ausência de limite de linhas, teto monetário e prova agregada SQL",()=>{
 const mig=read("supabase/pending-migrations/20261009170000_asaas_saque_total_acumulado_sem_corte_registros.sql");
 const residual=read("supabase/pending-migrations/20261009171000_asaas_evitar_residuo_apos_teto_pix.sql");
 const ui=read("js/motoboy.js");
 const html=read("pages/motoboy.html");
 const reserve=mig.slice(mig.indexOf("CREATE OR REPLACE FUNCTION public.catalogo_asaas_reservar_saque"),mig.indexOf("-- Consulta o saque como UM objeto JSON"));
 assert.match(reserve,/WITH elegiveis AS MATERIALIZED/);
 assert.match(reserve,/FOR UPDATE OF r/);
 assert.match(reserve,/pg_advisory_xact_lock/);
 assert.match(reserve,/sum\(valor_centavos::bigint\) OVER \(ORDER BY id\)/);
 assert.match(reserve,/v_limite_transferencia constant bigint:=500000/);
 assert.match(reserve,/IF v_total<10000/);
 assert.doesNotMatch(reserve,/\bLIMIT\s+(?:100|1000)\b/);
 assert.match(mig,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_validar_reserva_saque/);
 assert.match(mig,/bool_and\(/);
 assert.match(mig,/v_ativos=v_qtd/);
 assert.match(mig,/v_total=v_saque\.valor_centavos/);
 assert.match(mig,/coalesce\(sum\(r\.valor_centavos::bigint\),0\)/);
 assert.match(mig,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_validar_reserva_saque\(uuid\) FROM PUBLIC,anon,authenticated/);
 assert.match(residual,/t\.soma_total-v_limite_transferencia<10000/);
 assert.match(residual,/t\.soma_total-10000/);
 assert.match(edge,/const SAQUE_MAXIMO_PIX_CENTAVOS=500000/);
 assert.match(edge,/saque_maximo_por_pix_centavos:SAQUE_MAXIMO_PIX_CENTAVOS/);
 assert.match(edge,/total_comissoes_disponiveis:Number\(balance\.creditos\|\|0\)/);
 assert.match(edge,/db\.rpc\("catalogo_asaas_validar_reserva_saque",\{p_saque:ref\}\)/);
 assert.doesNotMatch(edge,/records\.length<=1000/);
 assert.doesNotMatch(edge,/\.from\("catalogo_asaas_saque_itens"\)\.select\("ativo,remuneracao_id,/);
 assert.match(ui,/motoboyCreditoContagem/);
 assert.match(ui,/Math\.min\(/);
 assert.match(html,/id="motoboyCreditoContagem"/);
});


test("PostgreSQL em memoria prova mais de 1000 comissoes e evita saldo preso",async()=>{
 const {PGlite}=require("@electric-sql/pglite");
 const db=new PGlite();
 try {
  const ddl=[
   "CREATE SCHEMA catalogo_private",
   "CREATE FUNCTION catalogo_private.catalogo_v2_autorizado(uuid) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$SELECT true$$",
   "CREATE FUNCTION catalogo_private.catalogo_v2_financiado(uuid) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$SELECT true$$",
   "CREATE TABLE catalogo_motoboy_perfis(usuario_id uuid PRIMARY KEY,chave_pix_enc text,em_analise boolean)",
   "CREATE TABLE catalogo_pedidos(id uuid PRIMARY KEY,provedor text,entrega_status text,reembolso_pendente boolean,pagamento_revisao_pendente boolean)",
   "CREATE TABLE catalogo_comissoes_offline(pedido_id uuid PRIMARY KEY,comercio_id text,competencia text,status text)",
   "CREATE TABLE catalogo_fechamentos_offline(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),comercio_id text,competencia text,status text)",
   "CREATE TABLE catalogo_fatura_cobrancas(fechamento_id uuid,gateway text,status text,pago_em timestamptz)",
   "CREATE TABLE catalogo_remuneracoes_v2(id uuid PRIMARY KEY,pedido_id uuid,motoboy_id uuid,status text,financiamento_comprovado boolean,repasse_id uuid,valor_centavos integer)",
   "CREATE TABLE catalogo_asaas_saques(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),motoboy_id uuid,valor_centavos integer,status text NOT NULL DEFAULT 'reservado')",
   "CREATE TABLE catalogo_asaas_saque_itens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),saque_id uuid,remuneracao_id uuid,ativo boolean NOT NULL DEFAULT true)",
   "CREATE UNIQUE INDEX test_credito_ativo ON catalogo_asaas_saque_itens(remuneracao_id) WHERE ativo"
  ].join(";\n")+";";
  await db.exec(ddl);
  const latest=read("supabase/pending-migrations/20261009171000_asaas_evitar_residuo_apos_teto_pix.sql");
  const first=latest.indexOf("CREATE OR REPLACE FUNCTION public.catalogo_asaas_reservar_saque");
  const end=latest.indexOf("REVOKE ALL ON FUNCTION",first);
  assert(first>=0 && end>first);
  await db.exec(latest.slice(first,end));
  const base=read("supabase/pending-migrations/20261009170000_asaas_saque_total_acumulado_sem_corte_registros.sql");
  const v=base.indexOf("CREATE OR REPLACE FUNCTION public.catalogo_asaas_validar_reserva_saque");
  const e=base.indexOf("-- A carteira soma por BIGINT",v);
  assert(v>=0 && e>v);
  await db.exec(base.slice(v,e));
  const riders=[
   {id:"11111111-1111-4111-8111-111111111111",prefix:"centavos",qtd:1300,valor:50},
   {id:"22222222-2222-4222-8222-222222222222",prefix:"limite",qtd:501,valor:1000}
  ];
  for(const c of riders){
   await db.query("INSERT INTO catalogo_motoboy_perfis VALUES($1,'pix-ficticio',false)",[c.id]);
   await db.query("INSERT INTO catalogo_fechamentos_offline(comercio_id,competencia,status) VALUES($1,'2026-09','pago')",["loja-"+c.prefix]);
   await db.query("INSERT INTO catalogo_fatura_cobrancas SELECT id,'asaas','pago',now() FROM catalogo_fechamentos_offline WHERE comercio_id=$1",["loja-"+c.prefix]);
   await db.query("INSERT INTO catalogo_pedidos SELECT md5($1||g::text)::uuid,'offline','entregue',false,false FROM generate_series(1,$2::int) g",[c.prefix,c.qtd]);
   await db.query("INSERT INTO catalogo_comissoes_offline SELECT md5($1||g::text)::uuid,$2,'2026-09','paga' FROM generate_series(1,$3::int) g",[c.prefix,"loja-"+c.prefix,c.qtd]);
   await db.query("INSERT INTO catalogo_remuneracoes_v2 SELECT md5('rem'||$1||g::text)::uuid,md5($1||g::text)::uuid,$2::uuid,'disponivel',true,NULL,$3::int FROM generate_series(1,$4::int) g",[c.prefix,c.id,c.valor,c.qtd]);
  }
  const row=await db.query("SELECT public.catalogo_asaas_reservar_saque($1::uuid) AS r",[riders[0].id]);
  const a=row.rows[0].r;
  assert.equal(a.ok,true);assert.equal(Number(a.valor_centavos),65000);
  assert.equal(Number(a.creditos_incluidos),1300);
  const items=await db.query("SELECT count(*)::int AS qtd FROM catalogo_asaas_saque_itens WHERE saque_id=$1::uuid",[a.saque_id]);
  assert.equal(items.rows[0].qtd,1300,"Todas as 1300 comissoes devem ficar na mesma reserva");
  const again=await db.query("SELECT public.catalogo_asaas_reservar_saque($1::uuid) AS r",[riders[0].id]);
  assert.equal(again.rows[0].r.ok,false,"Não pode reservar duas vezes os mesmos creditos");
  await db.query("UPDATE catalogo_asaas_saques SET status='enviado' WHERE id=$1::uuid",[a.saque_id]);
  const validation=await db.query("SELECT public.catalogo_asaas_validar_reserva_saque($1::uuid) AS r",[a.saque_id]);
  assert.equal(validation.rows[0].r.elegivel,true,"Validação deve percorrer mais de mil créditos");
  assert.equal(Number(validation.rows[0].r.quantidade),1300);
  const capped=await db.query("SELECT public.catalogo_asaas_reservar_saque($1::uuid) AS r",[riders[1].id]);
  assert.equal(capped.rows[0].r.ok,true);
  assert.equal(Number(capped.rows[0].r.valor_centavos),491000);
  const last=await db.query("SELECT public.catalogo_asaas_reservar_saque($1::uuid) AS r",[riders[1].id]);
  assert.equal(last.rows[0].r.ok,true);
  assert.equal(Number(last.rows[0].r.valor_centavos),10000);
  const counted=await db.query("SELECT count(*)::int AS qtd FROM catalogo_asaas_saque_itens WHERE saque_id IN ($1::uuid,$2::uuid)",[capped.rows[0].r.saque_id,last.rows[0].r.saque_id]);
  assert.equal(counted.rows[0].qtd,501,"Nenhum credito pode ficar perdido na divisão");
 }finally{await db.close();}
});
