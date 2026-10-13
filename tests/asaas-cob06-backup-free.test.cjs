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


test("COB-06 Free: fail-closed antes de credenciais ou escrita em disco nao criptografado",()=>{
 assert.match(script,/function Validar-Volume-Seguro\(\[string\]\$Caminho\)/);
 assert.match(script,/Get-BitLockerVolume -MountPoint \$Unidade -ErrorAction Stop/);
 assert.match(script,/ProtectionStatus -ne 'On'/);
 assert.match(script,/VolumeStatus -ne 'FullyEncrypted'/);
 assert.match(script,/EncryptionPercentage -ne 100/);
 assert.match(script,/BACKUP_BLOQUEADO/);
 assert.match(script,/DestinoSeguro/);
 const start=script.indexOf("Validar-Volume-Seguro -Caminho $StoreRoot");
 const prompt=script.indexOf("Read-Host 'Digite BACKUP-FREE-PRODUCAO");
 const create=script.indexOf("New-Item -ItemType Directory");
 const link=script.indexOf("Executar-CLI -Argumentos @('link'");
 assert.ok(start>=0&&prompt>start&&create>start&&link>start,
  "Teste de criptografia deve ocorrer antes de interagir com Supabase ou gravar");
 assert.match(script,/Backup em caminho de rede\/UNC nao permitido/);
});


test("COB-06 Free: -Modo Verificar -DestinoSeguro valida BitLocker sem conectar",()=>{
 const start=script.indexOf("if ($Modo -eq 'Verificar')");
 const end=script.indexOf("Validar-Volume-Seguro -Caminho $StoreRoot",start);
 const ret=script.indexOf("  return",start);
 assert.ok(start>=0&&end>start&&ret>end);
 assert.match(script.slice(start,ret),/IsNullOrWhiteSpace\(\$DestinoSeguro\)/);
});
test("COB-06 Free: TEMP/TMP usados pelo CLI apontam para D: e sao restaurados",()=>{
 const temp=script.indexOf("$TempSeguro=Join-Path $Workspace '_temporarios'");
 const env=script.indexOf("$env:TEMP=$TempSeguro",temp);
 const dump=script.indexOf("$args=@('db','dump'",temp);
 assert.ok(temp>=0&&env>temp&&dump>env);
 assert.match(script,/New-Item -ItemType Directory -Path \$TempSeguro -Force/);
 assert.match(script,/\$env:TMP=\$TempSeguro/);
 assert.match(script,/\$env:TMPDIR=\$TempSeguro/);
 assert.match(script,/\$env:TEMP=\$OldTEMP/);
 assert.match(script,/\$env:TMP=\$OldTMP/);
 assert.match(script,/\$env:TMPDIR=\$OldTMPDIR/);
 assert.match(script,/NAO move automaticamente o disco interno do Docker Desktop/);
});


test("COB-06 Free: exporta auth.users e storage.objects explicitamente",()=>{
 assert.match(script,/\@\{file='auth_data.sql';args=\@\('--use-copy','--data-only','--schema','auth'\)\}/);
 assert.match(script,/\@\{file='storage_metadata.sql';args=\@\('--use-copy','--data-only','--schema','storage'/);
 assert.match(script,/Select-String -LiteralPath \$target -Pattern '\^COPY/);
 assert.match(script,/auth_data.sql nao contem COPY auth.users/);
 assert.match(script,/storage_metadata.sql nao contem COPY storage.objects/);
 assert.match(script,/sete arquivos SQL/);
 assert.match(script,/exportacoes sequenciais sem snapshot global/);
 assert.match(guide,/auth_data.sql/);
 assert.match(guide,/storage_metadata.sql/);
});
