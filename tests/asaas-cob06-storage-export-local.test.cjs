"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const ps=fs.readFileSync(
 "scripts/validacao-pagamentos/asaas-cob06-exportar-storage-producao.ps1","utf8");

test("COB06: exportacao Storage permanece verificacao local por padrao",()=>{
 assert.match(ps,/\[ValidateSet\('Verificar','Exportar'\)\]/);
 assert.match(ps,/\[string\]\$Modo='Verificar'/);
 assert.match(ps,/if \(\$Modo -eq 'Verificar'\)/);
 assert.match(ps,/return\s*\n\}/);
 assert.match(ps,/Read-Host 'Digite EXPORTAR-STORAGE-PRODUCAO/);
 assert.match(ps,/\$Confirmacao -ceq 'EXPORTAR-STORAGE-PRODUCAO'/);
});

test("COB06: origem e somente PROD explicitamente vinculado",()=>{
 assert.match(ps,/\$ProjectRef='xdmbkflufsfqziixzpxc'/);
 assert.match(ps,/supabase\\\.temp\\project-ref/);
 assert.match(ps,/PROJETO_INCORRETO/);
 assert.match(ps,/PROJETO_NAO_VINCULADO/);
 assert.match(ps,/PROJETO_SEM_CONFIGURACAO/);
 assert.match(ps,/CLI_INCOMPATIVEL/);
 assert.match(ps,/\('ss:\/\/\/'\+\$Bucket\),\$DestinoCli/);
 assert.match(ps,/\$CliArgs=@\('storage','cp','--experimental','--linked','--recursive'/);
 assert.doesNotMatch(ps,/\$args=@\('storage','(?:rm|mv)'/);
});

test("COB06: snapshots por bucket cobrem os 128 objetos e bytes observados",()=>{
 const expected=[
  ["cadastros",99,107180184],["catalogos",6,522686],
  ["mural-imagens",8,13358595],["noticias-eventos",7,5083718],
  ["perfil-fotos",8,7709841],
 ];
 for(const [name,count,bytes] of expected){
  const escaped=name.replace(/[-/\\^$*+?.()|[\]{}]/g,"\\$&");
  assert.match(ps,new RegExp(
   "bucket='"+escaped+"';quantidade="+count+";bytes="+bytes+"L"));
 }
 assert.equal(expected.reduce((sum,b)=>sum+b[1],0),128);
 assert.equal(expected.reduce((sum,b)=>sum+b[2],0),133855024);
 assert.match(ps,/CONTAGEM_DIVERGENTE_/);
 assert.match(ps,/BYTES_DIVERGENTES_/);
 assert.match(ps,/CONTAGEM_FINAL_DIVERGENTE/);
});

test("COB06: dados ficam em BitLocker e nunca em workspace Git",()=>{
 assert.match(ps,/Get-BitLockerVolume/);
 assert.match(ps,/ProtectionStatus -eq 'On'/);
 assert.match(ps,/VolumeStatus -eq 'FullyEncrypted'/);
 assert.match(ps,/EncryptionPercentage -eq 100/);
 assert.match(ps,/DESTINO_SOB_REPOSITORIO_GIT/);
 assert.match(ps,/TOKEN_TEXTO_CLARO/);
 assert.match(ps,/DIRETORIO_REDIRECIONADO/);
 assert.match(ps,/ARQUIVO_REDIRECIONADO/);
 assert.match(ps,/SHA256=\(Get-FileHash/);
 assert.match(ps,/ESTADO_INCOMPLETO\.txt/);
 assert.match(ps,/EXPORTACAO_STORAGE_CONFERIDA\.txt/);
 const completed=ps.lastIndexOf("Set-Content -LiteralPath (Join-Path $Raiz 'EXPORTACAO_STORAGE_CONFERIDA.txt')");
 const removed=ps.lastIndexOf("Remove-Item -LiteralPath (Join-Path $Raiz 'ESTADO_INCOMPLETO.txt')");
 assert.ok(completed>=0&&removed>completed,"selo criado antes da remocao do hold local");
});

test("COB06: exportacao nao e restore, nao libera Pix nem altera Storage remoto",()=>{
 assert.doesNotMatch(ps,/\b(?:db push|db reset|migration up|storage rm|storage mv)\b/i);
 assert.match(ps,/Nao restaura, deleta, atualiza Storage remoto nem emite Pix/);
 assert.match(ps,/Ainda falta copia externa independente e teste de recuperacao/);
});
