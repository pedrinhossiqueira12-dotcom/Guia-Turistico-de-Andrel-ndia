"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const script=fs.readFileSync("scripts/validacao-pagamentos/asaas-cob06-backup-free-producao.ps1","utf8");
const guide=fs.readFileSync("docs/ASAAS_COB06_BACKUP_MANUAL_FREE_WINDOWS_20261012.md","utf8");

test("COB-06 Free: modo padrao somente preflight, backup exige consentimento explicito",()=>{
 assert.match(script,/\[string\]\$Modo = 'Verificar'/);
 assert.match(script,/ValidateSet\('Verificar','Executar'\)/);
 assert.match(script,/if \(\$Modo -eq 'Verificar'\)/);
 assert.match(script,/Read-Host 'Digite BACKUP-FREE-PRODUCAO/);
 assert.match(script,/\$Confirmacao -cne 'BACKUP-FREE-PRODUCAO'/);
 assert.match(script,/\$ProjectRef='xdmbkflufsfqziixzpxc'/);
 assert.match(script,/if \(\$LinkedRef -cne \$ProjectRef\)/);
 assert.ok(script.indexOf("if ($Modo -eq 'Verificar')") <
   script.indexOf("Executar-CLI -Argumentos @('link'"));
});

test("COB-06 Free: dump nunca faz mutação ou envia dados a repositório",()=>{
 const code=script.replace(/#[^\n]*/g,"").replace(/<#[\s\S]*?#>/g,"");
 assert.match(code,/supabase db dump|@'db','dump'|@\(\'db\',\'dump\'/);
 assert.match(code,/'--linked'/);
 assert.match(code,/'--role-only'/);
 assert.match(code,/'--use-copy','--data-only'/);
 assert.match(code,/'supabase_migrations'/);
 assert.match(code,/Get-FileHash.*SHA256/);
 for(const dangerous of [
  "db reset","db push","db pull","functions deploy","migration up",
  "service_role","supabase db restore",
  "git push","git add","Invoke-WebRequest","Invoke-RestMethod",
  "Set-ItemProperty","Remove-Item"
 ]) assert.ok(!code.toLowerCase().includes(dangerous.toLowerCase()),dangerous);
 assert.match(script,/GuiaAndrelandiaBackupsPrivados/);
 assert.match(script,/BACKUP-FREE-PRODUCAO/);
});

test("COB-06 Free: runbook distingue exportação de restaurabilidade e exige cópia externa criptografada",()=>{
 for(const s of [
  "Free Plan does not include project backups",
  "-Modo Verificar","-Modo Executar","BitLocker","Storage","fora do computador",
  "manifesto.txt","RESTaURAÇÃO","Nenhum backup da base real"
 ]) {
  if(s==="RESTaURAÇÃO") assert.match(guide,/restaur[aá]ç[aã]o/i);
  else assert.ok(guide.includes(s),s);
 }
 assert.match(guide,/não copia as fotografias\/imagens/i);
 assert.match(guide,/Nenhum backup da base real foi criado por ChatGPT/i);
});
