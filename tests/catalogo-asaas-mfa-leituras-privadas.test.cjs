"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=fs.readFileSync("supabase/pending-migrations/20261010019000_leituras_privadas_unchallenge_mfa_inertes.sql","utf8");
const pg=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");
const ts=fs.readFileSync("supabase/functions/_shared/catalogo-asaas-mfa-orquestrador-prechallenge-inerte.ts","utf8");
const pipeline=fs.readFileSync(".github/workflows/database-tests.yml","utf8");

test("readers SQL privados nao abrem Data API nem service_role",()=>{
 assert.match(read,/CREATE FUNCTION catalogo_private\.catalogo_asaas_ler_contexto_prechallenge_inerte\(/);
 assert.match(read,/CREATE FUNCTION catalogo_private\.catalogo_asaas_ler_tentativa_prechallenge_inerte\(/);
 assert.equal((read.match(/SECURITY INVOKER/g)||[]).length,2);
 assert.equal((read.match(/REVOKE ALL ON FUNCTION/g)||[]).length,2);
 assert.equal((read.match(/FROM PUBLIC,anon,authenticated,service_role;/g)||[]).length,2);
 assert.doesNotMatch(read,/\bGRANT\b(?!\s+para\b)/);
 assert.doesNotMatch(read,/SECURITY DEFINER/);
 assert.doesNotMatch(read,/CREATE POLICY/);
});

test("readers recuperam contexto e desafio do SQL original sem depender do browser",()=>{
 for(const part of [
  "catalogo_asaas_contextos_pre_mfa_inertes",
  "catalogo_asaas_reservas_prechallenge_compartilhadas_inertes",
  "catalogo_asaas_desafios_prechallenge_compartilhados_inertes",
  "catalogo_asaas_consumos_prechallenge_compartilhados_inertes",
  "catalogo_asaas_prechallenge_elegivel_inerte",
  "v_c.expira_em IS DISTINCT FROM v_r.expira_em",
  "NOT EXISTS(",
  "used.tentativa=d.tentativa OR used.nonce=d.nonce",
  "used.challenge_id=d.challenge_id",
  "RETURN NULL",
  "'userId',v_c.revisor_id::text",
  "'sessionId',v_c.sessao_id::text",
  "'factorId',v_c.fator_id::text",
  "'evidenceHash',v_c.fingerprint_creditos_sha256",
  "'challengeId',v_challenge::text",
  "'contexto',v_contexto"
 ])assert.ok(read.includes(part),"Missing persisted security gate "+part);
 for(const dangerous of ["/auth/v1/factors/", "POST /transfers", "access_token", "refresh_token", "Bearer "])
  assert.ok(!read.includes(dangerous),"SQL migration should not handle bearer/OTP/money: "+dangerous);
});

test("CI test suite exercita contexto, challenge, expiração, AAL2 e controles de privilegio",()=>{
 for(const needle of [
  "Leitura SQL do contexto AAL1 nao confere com Auth/Escrow",
  "Leitura de contexto ficticio encontrou dados reais",
  "Leitura antecipada revelou challenge ainda nao registrado",
  "Leitura SQL da tentativa nao mantem nonce/challenge original",
  "Leitura de tentativa alheia nao foi negada",
  "Tentativa ja consumida foi relida apos OTP",
  "Snapshot AAL1 foi relido apos sessao ser promovida AAL2",
  "catalogo_asaas_ler_contexto_prechallenge_inerte(uuid)','EXECUTE'",
  "catalogo_asaas_ler_tentativa_prechallenge_inerte(uuid)','EXECUTE'"
 ])assert.ok(pg.includes(needle),"Missing live PG regression "+needle);
 assert.match(pipeline,/supabase\/pending-migrations\/\*\.sql/);
 assert.match(pipeline,/catalogo-asaas-staged-guards-postgres\.sql/);
});

test("interfaces do orquestrador correspondem a objetos JSONB do owner SQL",()=>{
 for(const prop of ["id","userId","sessionId","factorId","separationId","evidenceHash","expiresAt"])
  assert.ok(read.includes("'"+prop+"'"),"SQL context field missing "+prop);
 for(const prop of ["nonce","tentativa","challengeId","contexto"])
  assert.ok(read.includes("'"+prop+"'"),"SQL attempt field missing "+prop);
 assert.match(ts,/lerContexto\(contextoId: string\)/);
 assert.match(ts,/lerTentativa\(tentativa: string\)/);
 assert.match(ts,/reserva_sql_recusada_ou_sem_hold/);
 assert.match(ts,/consumo_sql_recusado_ou_sem_hold/);
 assert.match(ts,/status_operacional: "HOLD_OBRIGATORIO"/);
});
