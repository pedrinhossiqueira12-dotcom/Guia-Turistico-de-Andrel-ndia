"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {validate,compare,sha256}=require("../scripts/verificar-ancora-escrow.cjs");
const exportSql=fs.readFileSync("supabase/pending-migrations/20261009235959_exportar_ancora_externa_dossie.sql","utf8");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const ui=fs.readFileSync("js/admin-encerramentos.js","utf8");
const ci=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");

function make(events=[],context={}) {
 const result={
  ok:true,formato:"GAESCROW1",
  separacao_id:"11111111-2222-4333-8444-555555555555",
  solicitacao_id:"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  motoboy_id:"bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  tipo:"saida",valor_centavos:12000,creditos:2,
  fingerprint_creditos_sha256:"f".repeat(64),
  eventos_total:events.length,
  hash_final_dossie_sha256:events.at(-1)?.evento_sha256||"0".repeat(64),
  creditos_atuais_integros:true,observacoes_bancarias_total:0,observacoes_done:0,
  eventos_hashes:events,hash_ancora_sha256:"",
  cadeia_verificada_localmente:true,ancora_externa_efetuada:false,
  pagamento_autorizado:false,liberacao_autorizada:false,baixa_realizada:false,
  ...context
 };
 result.hash_ancora_sha256=sha256([
  "GAESCROW1",result.separacao_id,result.tipo,result.solicitacao_id,
  result.motoboy_id,result.valor_centavos,result.creditos,
  result.fingerprint_creditos_sha256,result.eventos_total,
  result.hash_final_dossie_sha256,String(result.creditos_atuais_integros),
  result.observacoes_bancarias_total,result.observacoes_done
 ].join("|"));
 return result;
}
function events(n){
 let prev="0".repeat(64);
 const arr=[];
 for(let i=1;i<=n;i++){
  const hash=sha256("synthetic test event "+i);
  arr.push({seq:i,hash_anterior_sha256:prev,evento_sha256:hash});
  prev=hash;
 }
 return arr;
}

test("manifesto vazio e com 2 eventos reproduzem SHA e encadeamento independentes",()=>{
 const zero=make(),two=make(events(2));
 assert.equal(validate(zero).eventos,0);
 assert.equal(validate(two).eventos,2);
 assert.equal(validate(two).hash,two.hash_ancora_sha256);
 assert.deepEqual(compare(two,zero),{novos_eventos:2,contexto_financeiro_mudou:false});
});
test("comparação com cópia arquivada rejeita redução e substituição do histórico",()=>{
 const antigo=make(events(2));
 assert.throws(()=>compare(make(events(1)),antigo),/encurtou/);
 const trocado=make(events(2).map((e,i)=>i===0?{
  ...e,evento_sha256:"1".repeat(64)
 }: {...e,hash_anterior_sha256:"1".repeat(64)}));
 validate(trocado);
 assert.throws(()=>compare(trocado,antigo),/difere da cópia arquivada/);
});
test("verificador rejeita qualquer adulteração da estrutura ou SHA",()=>{
 const a=make(events(2));a.hash_ancora_sha256="b".repeat(64);
 assert.throws(()=>validate(a),/âncora divergente/);
 const b=make(events(2));b.eventos_hashes[1].hash_anterior_sha256="0".repeat(64);
 assert.throws(()=>validate(b),/Encadeamento inválido/);
 const c=make(events(2));c.eventos_hashes.pop();
 assert.throws(()=>validate(c),/Lista de eventos incompleta/);
 const d=make(events(2));d.pagamento_autorizado=true;
 assert.throws(()=>validate(d),/segurança/);
});
test("alterações legítimas de observações bancárias são alertadas, não ignoradas",()=>{
 const antigo=make(events(2)),atual=make(events(3),{
  observacoes_bancarias_total:1,observacoes_done:1,creditos_atuais_integros:false
 });
 assert.deepEqual(compare(atual,antigo),{
  novos_eventos:1,contexto_financeiro_mudou:true
 });
});
test("não há limite oculto de 1000 eventos por manifesto",()=>{
 const grande=make(events(1001));assert.equal(validate(grande).eventos,1001);
});
test("SQL exige função local íntegra e só entrega hashes de eventos",()=>{
 assert.match(exportSql,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_exportar_ancora_dossie/);
 assert.match(exportSql,/catalogo_asaas_verificar_integridade_dossie_escrow/);
 assert.match(exportSql,/catalogo_asaas_diagnosticar_separacao_excepcional/);
 assert.match(exportSql,/pg_catalog\.sha256\(/);
 assert.match(exportSql,/v_canon:='GAESCROW1\|'/);
 assert.match(exportSql,/jsonb_agg\(jsonb_build_object\(/);
 assert.match(exportSql,/'eventos_hashes',v_eventos/);
 assert.match(exportSql,/'ancora_externa_efetuada',false/);
 assert.match(exportSql,/'pagamento_autorizado',false/);
 assert.match(exportSql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_exportar_ancora_dossie\(uuid\)/);
 assert.doesNotMatch(exportSql,/GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_exportar_ancora_dossie\(uuid\)\s*TO authenticated/);
 assert.doesNotMatch(exportSql,/\bUPDATE public\.|POST \/transfers/);
});
test("Admin exporta arquivo local sem subir documento nem transferir dinheiro",()=>{
 assert.match(edge,/uid!==ADMIN_USER_ID/);
 assert.match(edge,/case "exportar_ancora_dossie_admin":return await exportarAncoraEscrowAdmin\(user\.id,body\)/);
 assert.match(ui,/acao:"exportar_ancora_dossie_admin"/);
 assert.match(ui,/Exportar âncora SHA-256 \(JSON\)/);
 assert.match(ui,/URL\.createObjectURL\(arquivo\)/);
 assert.match(ui,/link\.download="guia-escrow-"/);
 assert.match(ui,/Guarde o JSON em local seguro, fora do Supabase/);
 assert.match(ci,/v_ancora_zerada->>'eventos_total' IS DISTINCT FROM '0'/);
 assert.match(ci,/v_ancora_dois->>'eventos_total' IS DISTINCT FROM '2'/);
 assert.match(ci,/Dossie adulterado gerou manifesto confiavel/);
});
