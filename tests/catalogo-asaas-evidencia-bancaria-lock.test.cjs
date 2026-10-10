"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const migration=fs.readFileSync("supabase/pending-migrations/20261009235500_serializar_evidencia_bancaria_com_saque.sql","utf8");
const ci=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");
const regular=fs.readFileSync("supabase/pending-migrations/20261009223000_trava_comum_saque_regular_e_revisao_excepcional.sql","utf8");
const evidence=fs.readFileSync("supabase/pending-migrations/20261009220500_evidencias_transferencia_excepcional_sandbox.sql","utf8");

test("evidencia excepcional tem a MESMA trava por motoboy do saque regular",()=>{
 const lock="hashtextextended('asaas-saque:'||NEW.motoboy_id::text,0)";
 assert.ok(migration.includes(lock),"Evidencia deve ter lock compartilhado exato");
 assert.ok(regular.includes(lock),"Reserva comum deve ter mesmo lock");
 assert.match(migration,/CREATE TRIGGER catalogo_asaas_serializar_evidencia_excepcional\s+BEFORE INSERT ON public\.catalogo_asaas_transferencias_excepcionais_auditoria/);
 assert.match(migration,/pg_catalog\.pg_advisory_xact_lock/);
 assert.match(evidence,/guia-exc-banco:/);
});
test("insercao bancária não aceita adulterar titular, referencia de pedido ou saldo",()=>{
 assert.match(migration,/IF NEW\.tipo='residual' THEN/);
 assert.match(migration,/ELSIF NEW\.tipo='saida' THEN/);
 assert.match(migration,/WHERE r\.id=NEW\.solicitacao_id/g);
 assert.match(migration,/v_motoboy IS DISTINCT FROM NEW\.motoboy_id/);
 assert.match(migration,/v_valor IS DISTINCT FROM NEW\.valor_centavos/);
 assert.match(migration,/RAISE EXCEPTION 'Evidencia nao pertence ao titular ou valor da solicitacao'/);
 assert.match(migration,/FROM PUBLIC,anon,authenticated,service_role/);
 assert.doesNotMatch(migration,/UPDATE public\.catalogo_remuneracoes_v2|\/transfers","POST"|p_estado:"concluido"|DROP TABLE/);
});
test("prova tardia jamais pode ser apagada ou convertida em baixa automática",()=>{
 assert.match(migration,/Mesmo quando um saque comum ja foi concluido/);
 assert.match(ci,/DO \$bank_evidence_serialized\$/);
 assert.match(ci,/Evidencia aceita com titular diferente/);
 assert.match(ci,/Evidencia aceita com valor adulterado/);
 assert.match(ci,/pagamento_baixado/);
 assert.match(ci,/pg_get_functiondef/);
 assert.match(ci,/Evidencia sem trava compartilhada/);
 assert.match(ci,/Permitiu saque comum durante observacao bancaria/);
});
test("dois meses de comissao totalizam R$120 e deixam solicitacao de saida aberta",()=>{
 assert.match(ci,/DO \$orphan_large_balance\$/);
 assert.match(ci,/FOR v_i IN 1\.\.2 LOOP/);
 assert.match(ci,/v_before->>'disponivel_centavos' <> '12000'/);
 assert.match(ci,/v_before->>'creditos' <> '2'/);
 assert.match(ci,/catalogo_asaas_regularizacoes_inativos/);
 assert.match(ci,/Permitiu pedido de saida em duplicidade/);
 assert.match(ci,/Permitiu revisao residual enquanto saida em aberto/);
 assert.match(ci,/Permitiu saque comum sem vinculo durante saida/);
});
