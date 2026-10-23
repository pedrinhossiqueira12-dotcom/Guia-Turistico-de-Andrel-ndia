"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const migration=fs.readFileSync("supabase/pending-migrations/20261010018000_reservas_prechallenge_compartilhadas_inertes.sql","utf8");
const regression=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");
const workflow=fs.readFileSync(".github/workflows/database-tests.yml","utf8");
test("nonce/challenge/tentativa sao unicos no banco e auditados em tabelas imutaveis",()=>{
 for(const text of [
  "CREATE TABLE public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes",
  "contexto_id uuid PRIMARY KEY",
  "nonce uuid NOT NULL UNIQUE",
  "CREATE TABLE public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes",
  "challenge_id uuid NOT NULL UNIQUE",
  "tentativa uuid NOT NULL UNIQUE",
  "CREATE TABLE public.catalogo_asaas_consumos_prechallenge_compartilhados_inertes",
  "challenge_id uuid PRIMARY KEY",
  "ENABLE ROW LEVEL SECURITY",
  "BEFORE UPDATE OR DELETE",
  "FROM PUBLIC,anon,authenticated,service_role"
 ])assert.ok(migration.includes(text),"missing durable safeguard "+text);
 assert.doesNotMatch(migration,/\bGRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|EXECUTE)/i);
});
test("as tres portas SQL operam sob estado HOLD sem prova MFA ou Pix",()=>{
 for(const text of [
  "catalogo_asaas_reservar_inicio_compartilhado_inerte(",
  "catalogo_asaas_registrar_desafio_compartilhado_inerte(",
  "catalogo_asaas_consumir_desafio_compartilhado_inerte(",
  "WHERE id=p_contexto FOR UPDATE",
  "WHERE nonce=p_nonce FOR UPDATE",
  "WHERE challenge_id=p_challenge FOR UPDATE",
  "ON CONFLICT DO NOTHING",
  "catalogo_asaas_prechallenge_elegivel_inerte(",
  "catalogo_asaas_checar_fator_totp_aal1_inerte(",
  "catalogo_asaas_verificar_integridade_dossie_escrow",
  "catalogo_asaas_matriz_conciliacao_escrow",
  "'challenge_go_true_verificado',false",
  "'desafio_mfa_da_sessao_comprovado',false",
  "'pagamento_autorizado',false",
  "'liberacao_autorizada',false",
  "'baixa_realizada',false",
  "'movimenta_dinheiro',false",
  "'HOLD_OBRIGATORIO'"
 ])assert.ok(migration.includes(text),"missing fail-closed property "+text);
 for(const banned of ["/v3/transfers","/auth/v1/factors/","fetch(","Authorization: Bearer","PIX_EXECUTADO"])
  assert.ok(!migration.includes(banned),"unsafe live behavior "+banned);
});
test("CI exercita reserva unica, retry, troca de challenge, status AAL2 e RLS",()=>{
 for(const text of [
  "Reserva SQL prechallenge nao passou HOLD",
  "Contexto AAL1 aceitou nonce duplicado",
  "Segundo desafio no mesmo nonce foi aceito",
  "Desafio de outra tentativa passou consumo",
  "Replay de consumo SQL foi aceito",
  "Challenge ID escapou para outro nonce",
  "Consumo pre-OTP aceitou sessao alterada AAL2",
  "RPC ou tabela prechallenge compartilhada exposta ao cliente",
  "Reserva prechallenge permitiu DELETE",
  "Desafio prechallenge permitiu UPDATE",
  "Consumo prechallenge permitiu DELETE"
 ])assert.ok(regression.includes(text),"missing PostgreSQL regression "+text);
 assert.match(workflow,/catalogo-asaas-staged-guards-postgres\.sql/);
});
