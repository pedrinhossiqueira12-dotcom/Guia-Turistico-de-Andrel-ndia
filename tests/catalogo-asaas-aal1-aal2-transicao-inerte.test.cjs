"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const jwt=read("supabase/functions/_shared/catalogo-asaas-jwt-sessao-assinada-ensaio.ts");
const simulator=read("supabase/functions/_shared/catalogo-asaas-stepup-documental-ensaio.ts");
const transport=read("supabase/functions/_shared/catalogo-asaas-gotrue-mfa-transporte-inerte.ts");
const migration=read("supabase/pending-migrations/20261010015000_sessao_aal1_desafio_pre_mfa_inerte.sql");
const sql=read("supabase/tests/isolated/catalogo-asaas-aal1-pre-desafio-inerte-postgres.sql");
const ci=read(".github/workflows/database-tests.yml");

test("AAL1 so na etapa inicial, AAL2 e factor correto obrigatorios apos Auth verify",()=>{
 for(const x of [
  "async verificarInicio(token: string)",
  "return this.verificarInterno(token, true);",
  "return this.verificarInterno(token, false);",
  'claims.aal === "aal1"',
  'consultarSessaoBasica',
  'basica.aal !== "aal1"',
  "basica.usuarioBloqueado !== false",
  'factorId: null',
  "crypto.subtle.verify(",
  "if (!verified) return null",
 ])assert.ok(jwt.includes(x),"JWT phase check missing: "+x);
 assert.ok(jwt.indexOf("if (!verified) return null")<jwt.indexOf("consultarSessaoBasica;"),
  "basic auth lookup occurs before JWT signature validation");
 for(const x of [
  'autenticarToken(bearerToken, "inicio")',
  'autenticarToken(verificado.accessToken, "apos_verificacao")',
  "mesmoEstadoAntes(",
  "mesmaIdentidade(",
  "depois.factorId !== r.intencao.factorId",
  'depois.aal !== "aal2"',
  "status_operacional: \"HOLD_OBRIGATORIO\""
 ])assert.ok(simulator.includes(x),"MFA phase check missing "+x);
 assert.match(transport,/fase === "apos_verificacao" && principal.aal !== "aal2"/);
});

test("leitor owner-only AAL1 so retorna sessao ativa nao banida SEM claim factor",()=>{
 for(const x of [
  "SECURITY INVOKER SET search_path=''",
  "FROM auth.sessions s",
  "JOIN auth.users u ON u.id=s.user_id",
  "s.aal::text='aal1'",
  "s.factor_id IS NULL",
  "s.not_after IS NULL OR s.not_after>pg_catalog.now()",
  "u.banned_until IS NULL OR u.banned_until<=pg_catalog.now()",
  "'usuarioBloqueado', false",
  "REVOKE ALL ON FUNCTION",
  "FROM PUBLIC, anon, authenticated, service_role"
 ])assert.ok(migration.includes(x),"SQL reader control missing: "+x);
 assert.doesNotMatch(migration,/\bGRANT\b|\bINSERT\s+INTO\b|\bUPDATE\s+auth\.|\bDELETE\s+FROM\s+auth\./i);
 assert.doesNotMatch(migration,/challenge_id|verificacao_otp_realizada.*true|pagamento_autorizado.*true/);
});

test("CI exercita negativas PostgreSQL sem Data API nem banco STAGING",()=>{
 for(const marker of [
  "authenticated obteve acesso ao leitor AAL1 privado",
  "Fator associado antes de AAL2",
  "Sessao AAL2 passou por porta AAL1",
  "Sessao AAL1 expirada foi aceita",
  "Usuario banido foi aceito para challenge",
  "Sessao revogada AAL1 passou",
  "Leitor AAL1 declarou falso fator validado",
  "ROLLBACK;"
 ])assert.ok(sql.includes(marker),"Missing SQL negative "+marker);
 assert.ok(ci.includes("catalogo-asaas-aal1-pre-desafio-inerte-postgres.sql"));
 assert.match(sql,/current_database\(\)<>'catalogo_asaas_guards_ci'/);
});
