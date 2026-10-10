"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const slice=(begin,end)=>{
 const a=edge.indexOf(begin),b=edge.indexOf(end,a+begin.length);
 assert.ok(a>=0&&b>a,begin+" precisa existir antes de "+end);
 return edge.slice(a,b);
};
const auto=slice("async function reconcileTransfer(","async function auditPendingSandboxTransfer(");
const admin=slice("async function reconcileAdminTransfer(","// O hash corresponde ao destino usado no POST");
const proof=slice("async function destinoPixConfirmadoParaBaixa(","async function equalSecret(");
test("conclusão automatizada verifica fingerprint do Pix antes da RPC de baixa",()=>{
 assert.match(auto,/select\("id,valor_centavos,transferencia_id,status,pix_destino_sha256,pix_destino_registrado_em"\)/);
 assert.match(auto,/if\(status==="DONE"\)\{/);
 assert.match(auto,/check\(await destinoPixConfirmadoParaBaixa\(row,transfer\)/);
 assert.ok(auto.indexOf("destinoPixConfirmadoParaBaixa(row,transfer)")<
   auto.indexOf('p_estado:"concluido"'));
 assert.match(auto,/status==="DONE"[\s\S]*p_estado:"concluido"/);
});
test("recuperação administrativa também exige conferência da chave original",()=>{
 assert.match(admin,/uid!==ADMIN_USER_ID/);
 assert.match(admin,/select\("id,valor_centavos,transferencia_id,status,pix_destino_sha256,pix_destino_registrado_em"\)/);
 assert.match(admin,/check\(await destinoPixConfirmadoParaBaixa\(row,transfer\)/);
 assert.ok(admin.indexOf("destinoPixConfirmadoParaBaixa(row,transfer)")<
  admin.indexOf('p_estado:"concluido"'));
 assert.doesNotMatch(admin,/\/transfers","POST"|externalReference:saqueId/);
});
test("valor, tipo Pix e chave de destino no Asaas devem ser verificáveis",()=>{
 assert.match(proof,/\^\[a-f0-9\]\{64\}\$/);
 assert.match(proof,/pix_destino_registrado_em/);
 assert.match(proof,/Date\.parse\(carimbo\)/);
 assert.match(proof,/transfer\.operationType,12\)!=="PIX"/);
 assert.match(proof,/pixDestinationsMatch\(hash,\[transfer\]\)/);
 const impl=slice("async function pixDestinationsMatch(","async function destinoPixConfirmadoParaBaixa(");
 assert.match(impl,/if\(unique\.length===0\)return false/);
 assert.match(impl,/await pixFingerprint\(t,key\)/);
 assert.match(impl,/if\(!match\)return false/);
 assert.doesNotMatch(proof,/cpfCnpj===|ownerName===|identidade_comprovada:true/);
});
test("nenhum fluxo excepcional concede quitação com observação bancária parcial",()=>{
 const sql=fs.readFileSync("supabase/pending-migrations/20261009220500_evidencias_transferencia_excepcional_sandbox.sql","utf8");
 assert.match(sql,/'pagamento_baixado',false/);
 assert.match(edge,/observarTransferenciaExcepcionalSandboxAdmin/);
 assert.match(edge,/ENVIRONMENT!=="sandbox"/);
});
