"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const a=src.indexOf("async function authorizeWithdrawal(");
const b=src.indexOf("type AsaasWebhookPendente=",a);
assert.ok(a>=0 && b>a);
const handler=src.slice(a,b);

test("replay exige GET bancario e parecer atual ANTES de acessar aprovacao persistida",()=>{
 const initial=handler.indexOf('db.rpc(\n  "catalogo_asaas_validar_reserva_saque"');
 const bank=handler.indexOf('remote=await asaas("/transfers/"+encodeURIComponent(id)');
 const target=handler.indexOf("await pixDestinationsMatch(");
 const profile=handler.indexOf('db.from("catalogo_motoboy_perfis")');
 const stored=handler.indexOf('db.from("catalogo_asaas_validacoes_saque")');
 assert.ok(initial>=0&&bank>initial&&target>bank&&profile>target&&stored>profile,
  "autorizacao previamente armazenada foi lida sem repetir todas as provas");
 assert.match(handler,/if\(existing\)return approveResponse\(existing\.decisao==="APPROVED"&&decision==="APPROVED"/);
 assert.match(handler,/remote\.status==="PENDING"/);
 assert.doesNotMatch(handler,/!\["DONE","FAILED","CANCELLED"\]\.includes\(value\(remote\.status/);
});
test("corrida UNIQUE nunca reaproveita APPROVED com revalidacao REFUSED",()=>{
 assert.match(handler,/if\(insertError\?\.code==="23505"\)/);
 assert.match(handler,/stored\.decisao==="APPROVED"&&decision==="APPROVED"/);
 assert.match(handler,/return approveResponse\(stored\.decisao==="APPROVED"&&decision==="APPROVED"/);
 assert.match(handler,/if\(revalidacao\.elegivel!==true\)/);
 assert.match(handler,/if\(profile\.data\?\.apto===true/);
 assert.doesNotMatch(handler,/await asaas\("\/transfers","POST"/);
});
