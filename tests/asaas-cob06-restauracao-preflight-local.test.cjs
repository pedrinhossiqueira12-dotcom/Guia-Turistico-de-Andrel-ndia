"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const script=fs.readFileSync("scripts/validacao-pagamentos/asaas-cob06-restauracao-preflight-local.ps1","utf8");

function executableOnly(text){
 return text.replace(/<#(?:.|\n)*?#>/g, "").split("\n")
   .filter(line=>!/^\s*#/.test(line)).join("\n");
}
test("COB-06 restore preflight: obriga D: com BitLocker e confere sete hashes antes de analisar SQL",()=>{
 assert.match(script,/Get-BitLockerVolume -MountPoint 'D:' -ErrorAction Stop/);
 assert.match(script,/FullyEncrypted/);
 assert.match(script,/EncryptionPercentage -eq 100/);
 assert.match(script,/asaas-cob06-verificar-integridade-local\.ps1/);
 assert.match(script,/& \$Verificador -Pasta \$PastaCompleta/);
 const names=["roles.sql","schema.sql","data.sql","auth_data.sql",
 "storage_metadata.sql","history_schema.sql","history_data.sql"];
 for(const name of names) assert.ok(script.includes("'"+name+"'"),name);
 assert.ok(script.indexOf("& $Verificador -Pasta")<script.indexOf("$Leitor = "));
});
test("COB-06 restore preflight: sem rede, mutacoes remotas, containers ou exibicao SQL",()=>{
 const code=executableOnly(script);
 for(const prohibited of [
  "supabase login","supabase link","supabase db",
  "docker run","docker exec","docker pull","psql ",
  "Write-Output $Linha","Write-Host $Linha",
  "Remove-Item","Set-Content","Out-File","Invoke-WebRequest","Invoke-RestMethod",
  "Connect-","PGPASSWORD","service_role"
 ]) assert.ok(!code.toLowerCase().includes(prohibited.toLowerCase()),prohibited);
 assert.match(code,/StreamReader/);
 assert.match(code,/\$Leitor\.ReadLine\(\)/);
 assert.match(code,/REFERENCIAS_DDL/);
 assert.match(code,/RESTAURACAO_NAO_EXECUTADA/);
 assert.match(code,/1>\$null 2>\$null/);
 assert.match(code,/--format|\{\{\.ServerVersion\}\}/);
});
