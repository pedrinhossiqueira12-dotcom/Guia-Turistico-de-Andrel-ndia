"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const sql=read("supabase/pending-migrations/20261009235955_dossie_conciliacao_escrow_auditavel.sql");
const ci=read("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql");
const edge=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
const ui=read("js/admin-encerramentos.js");
const page=read("pages/admin-encerramentos.html");

test("dossiê imutável conserva histórico em vez de alterar créditos ou eventos antigos",()=>{
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.catalogo_asaas_escrow_dossie_eventos/);
 assert.match(sql,/separacao_id uuid NOT NULL REFERENCES public\.catalogo_asaas_separacoes_excepcionais/);
 assert.match(sql,/seq bigint NOT NULL CHECK\(seq>0\)/);
 assert.match(sql,/chave_idempotencia uuid NOT NULL UNIQUE/);
 assert.match(sql,/UNIQUE\(separacao_id,seq\)/);
 assert.match(sql,/ALTER TABLE public\.catalogo_asaas_escrow_dossie_eventos ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/GRANT SELECT ON public\.catalogo_asaas_escrow_dossie_eventos TO service_role/);
 assert.doesNotMatch(sql,/GRANT (INSERT|UPDATE|DELETE) ON public\.catalogo_asaas_escrow_dossie_eventos/);
 assert.doesNotMatch(sql,/UPDATE public\.catalogo_remuneracoes_v2|UPDATE public\.catalogo_asaas_separacoes_excepcionais|POST \/transfers/);
});

test("funcao anexa sequência com lock de motoboy, FOR UPDATE e hash encadeado",()=>{
 assert.match(sql,/pg_catalog\.pg_advisory_xact_lock/);
 assert.match(sql,/hashtextextended\('asaas-saque:'\|\|v_escrow\.motoboy_id::text,0\)/);
 assert.match(sql,/WHERE id=p_separacao FOR UPDATE/);
 assert.match(sql,/ORDER BY e\.seq DESC LIMIT 1/);
 assert.match(sql,/v_seq:=coalesce\(v_seq,0\)\+1/);
 assert.match(sql,/v_prev:=coalesce\(v_prev,repeat\('0',64\)\)/);
 assert.match(sql,/pg_catalog\.sha256\(pg_catalog\.convert_to/);
 assert.match(sql,/hash_anterior_sha256/);
 assert.match(sql,/evento_sha256/);
 assert.match(sql,/'pagamento_autorizado',false/);
 assert.match(sql,/'baixa_realizada',false/);
 assert.match(sql,/'liberacao_autorizada',false/);
});

test("idempotencia recusará reuso da mesma chave para um evento diferente",()=>{
 assert.match(sql,/WHERE chave_idempotencia=p_chave/);
 assert.match(sql,/v_existente\.separacao_id IS DISTINCT FROM p_separacao/);
 assert.match(sql,/v_existente\.autor_id IS DISTINCT FROM p_autor/);
 assert.match(sql,/v_existente\.categoria IS DISTINCT FROM p_categoria/);
 assert.match(sql,/v_existente\.descricao IS DISTINCT FROM v_descricao/);
 assert.match(sql,/v_existente\.documento_sha256 IS DISTINCT FROM p_documento_sha256/);
 assert.match(sql,/'repetido',true/);
 assert.match(sql,/'repetido',false/);
 assert.match(sql,/CHECK\(categoria<>'comprovante_externo' OR documento_sha256 IS NOT NULL\)/);
 assert.match(sql,/p_documento_sha256 !~ '\^\[a-f0-9\]\{64\}\$'/);
});

test("apenas handler de admin validado pode gravar e consultar, sem transferir",()=>{
 const start=edge.indexOf("async function listarDossieEscrowAdmin(");
 const end=edge.indexOf("// Somente conferencia de valores.",start);
 assert.ok(start>=0&&end>start);
 const handler=edge.slice(start,end);
 assert.match(handler,/if\(uid!==ADMIN_USER_ID\)/g);
 assert.match(handler,/catalogo_asaas_escrow_dossie_eventos/);
 assert.match(handler,/catalogo_asaas_registrar_evento_dossie_escrow/);
 assert.match(handler,/p_autor:uid/);
 assert.match(handler,/pagamento_autorizado===false/);
 assert.match(handler,/baixa_realizada===false/);
 assert.match(handler,/liberacao_autorizada===false/);
 assert.match(edge,/case "listar_dossie_escrow_admin":return await listarDossieEscrowAdmin\(user\.id,body\)/);
 assert.match(edge,/case "registrar_dossie_escrow_admin":return await registrarDossieEscrowAdmin\(user\.id,body\)/);
 assert.doesNotMatch(handler,/asaas\(|POST \/transfers|INSERT INTO|UPDATE public\./);
});

test("painel usa campo recolhível, exige justificativa e documenta que não autoriza Pix",()=>{
 assert.match(page,/details summary/);
 assert.match(ui,/document\.createElement\("details"\)/);
 assert.match(ui,/Dossiê de conciliação \(sem Pix\)/);
 assert.match(ui,/Não inclua dados pessoais/);
 assert.match(ui,/document\.createElement\("textarea"\)/);
 assert.match(ui,/nota\.maxLength=1000/);
 assert.match(ui,/crypto\.randomUUID\(\)/);
 assert.match(ui,/acao:"registrar_dossie_escrow_admin"/);
 assert.match(ui,/acao:"listar_dossie_escrow_admin"/);
 assert.match(ui,/Histórico parcial/);
 assert.match(ui,/Registrar ocorrência \(não paga\)/);
});

test("fixture valida duas ocorrências, repetição sem duplicar e evento externo sem baixa",()=>{
 assert.match(ci,/v_note1->>'seq' IS DISTINCT FROM '1'/);
 assert.match(ci,/v_repeat->>'repetido' IS DISTINCT FROM 'true'/);
 assert.match(ci,/v_note2->>'seq' IS DISTINCT FROM '2'/);
 assert.match(ci,/v_replay_err->>'ok' IS DISTINCT FROM 'false'/);
 assert.match(ci,/v_prev_hash IS DISTINCT FROM v_hash1/);
 assert.match(ci,/has_function_privilege\('authenticated',\s*'public\.catalogo_asaas_registrar_evento_dossie_escrow/);
});
