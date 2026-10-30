"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const start=edge.indexOf("async function consultarTitularidadePixSandboxAdmin(");
const end=edge.indexOf("async function listAdminPayouts(",start);
assert.ok(start>=0&&end>start,"Consulta Pix isolada nao encontrada");
const handler=edge.slice(start,end);

test("consulta de chave Pix só pode ser executada pelo administrador em Sandbox",()=>{
 assert.match(handler,/uid!==ADMIN_USER_ID/);
 assert.match(handler,/ENVIRONMENT!=="sandbox"/);
 assert.match(handler,/!ASAAS_TOKEN/);
 assert.match(handler,/\.eq\("id",requestId\)\.maybeSingle\(\)/);
 assert.match(handler,/\.eq\("usuario_id",solicitacao\.motoboy_id\)\.maybeSingle\(\)/);
 assert.match(edge,/case "consultar_titularidade_pix_sandbox_admin":return await consultarTitularidadePixSandboxAdmin\(user\.id,body\)/);
});

test("nenhuma chave real cadastrada é enviada ao Sandbox",()=>{
 assert.match(handler,/decryptCourierPix\(String\(profile\.chave_pix_enc\)/);
 assert.match(handler,/pixFingerprint\(pix\.pixAddressKeyType,pix\.pixAddressKey\)/);
 assert.match(handler,/pix\.pixAddressKeyType!=="PHONE"\|\|pix\.pixAddressKey!=="47996515839"/);
 assert.match(handler,/\/pix\/addressKeys\/external\?type=PHONE&key=47996515839/);
 assert.match(handler,/method:"GET"/);
 assert.doesNotMatch(handler,/\/transfers","POST"|await withdraw\(/);
});

test("sandbox não comprova CPF/CNPJ; nunca libera pagamento ou vaza dados",()=>{
 assert.match(handler,/titularidade_confirmada:false/g);
 assert.match(handler,/pagamento_autorizado:false/g);
 assert.match(handler,/provedor_retornou_documento:Boolean\(value\(provider\.cpfCnpj,30\)\)/);
 assert.doesNotMatch(handler,/cpfCnpj:\s*provider\.cpfCnpj|titularidade_confirmada:true|pagamento_autorizado:true/);
 assert.doesNotMatch(handler,/console\.log\(provider\)|console\.info\(provider\)/);
 assert.match(handler,/Respeite os limites de consulta/);
});
