"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const script = fs.readFileSync("scripts/validacao-pagamentos/asaas-cob06-verificar-integridade-local.ps1","utf8");

test("COB-06: apenas imprime INTEGRIDADE_LOCAL_OK depois de verificar SHA256 e tamanho para sete SQL",()=>{
  const names = ["roles.sql","schema.sql","data.sql","auth_data.sql",
    "storage_metadata.sql","history_schema.sql","history_data.sql"];
  for(const name of names) assert.ok(script.includes("'"+name+"'"),name);
  assert.match(script,/Get-Content -LiteralPath \$ManifestoPath/);
  assert.match(script,/\$Registros\.Count -ne \$NomesEsperados\.Count/);
  assert.match(script,/Get-FileHash -LiteralPath \$Caminho -Algorithm SHA256/);
  assert.match(script,/\$Item\.Length -ne \$TamanhoEsperado/);
  assert.match(script,/if \(\$HashAtual -ine \$HashEsperado\)/);
  assert.match(script,/MANIFESTO_INVALIDO/);
  const ok = script.indexOf("Write-Host 'INTEGRIDADE_LOCAL_OK");
  assert.ok(ok>script.indexOf("if ($HashAtual -ine $HashEsperado)"),
    "Mensagem positiva deve estar fora e depois de todas as validacoes.");
});
test("COB-06: verificacao de integridade nao conecta em bancos ou exibe dados SQL",()=>{
  for(const cmd of ["supabase login","supabase db","docker run","Invoke-WebRequest",
    "Invoke-RestMethod","Get-Content -LiteralPath $Caminho","Remove-Item","Set-Content"]) {
    assert.ok(!script.includes(cmd),cmd);
  }
  assert.match(script,/TrimStart\(\[char\]0xFEFF\)/);
  assert.match(script,/\$Metadados\.Count -ne 1 -and \$Metadados\.Count -ne 7/);
  assert.match(script,/\$Cabecalho -cnotmatch \$PadraoCabecalho/);
  assert.match(script,/gerado_utc=\[0-9\]/);
  assert.match(script,/projeto=xdmbkflufsfqziixzpxc/);
  assert.match(script,/estado=exportado_nao_restaurado/);
  assert.match(script,/NAO comprova restaurabilidade/);
});
