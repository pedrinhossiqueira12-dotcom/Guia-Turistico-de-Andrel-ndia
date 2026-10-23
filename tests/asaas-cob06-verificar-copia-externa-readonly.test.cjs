"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const script=fs.readFileSync("scripts/validacao-pagamentos/asaas-cob06-verificar-copia-externa-readonly.ps1","utf8");

test("COB06 copia externa exige disco fisico USB/SD distinto e BitLocker 100% ativo",()=>{
 assert.match(script,/Get-Partition -DriveLetter/);
 assert.match(script,/Get-Disk -Number/);
 assert.match(script,/\$DiscoOrigem\.Number -eq \$DiscoDestino\.Number/);
 assert.match(script,/@\('USB','SD'\) -notcontains/);
 assert.match(script,/Get-BitLockerVolume -MountPoint/);
 assert.match(script,/VolumeStatus -ne 'FullyEncrypted'/);
 assert.match(script,/ProtectionStatus -ne 'On'/);
 assert.match(script,/EncryptionPercentage -ne 100/);
 assert.match(script,/LockStatus -ne 'Unlocked'/);
 assert.match(script,/ReparsePoint/);
});
test("COB06 copia externa valida origem e oito hashes sem dados em saida ou escrita",()=>{
 assert.match(script,/asaas-cob06-verificar-integridade-local\.ps1/);
 for(const nome of ["manifesto.txt","roles.sql","schema.sql","data.sql",
   "auth_data.sql","storage_metadata.sql","history_schema.sql","history_data.sql"])
   assert.ok(script.includes("'"+nome+"'"),nome);
 assert.match(script,/Get-FileHash -LiteralPath \$Fonte -Algorithm SHA256/);
 assert.match(script,/Get-FileHash -LiteralPath \$Copia -Algorithm SHA256/);
 assert.match(script,/\$HashFonte -ine \$HashCopia/);
 assert.match(script,/COB06_COPIA_EXTERNA_INTEGRA/);
 for(const proibido of ["Copy-Item","Remove-Item","Set-Content","Out-File",
   "Invoke-WebRequest","Invoke-RestMethod","supabase login","docker run",
   "Format-Volume","Initialize-Disk","Enable-BitLocker","Unlock-BitLocker"])
   assert.ok(!script.includes(proibido),proibido);
 assert.ok(script.indexOf("COB06_COPIA_EXTERNA_INTEGRA")>script.indexOf("$HashFonte -ine $HashCopia"));
});
