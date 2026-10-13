<#
COB-06 — Confere integridade LOCAL do backup de producao (sem conexao ao Supabase).
NAO abre/imprime conteudo SQL nem transmite dados. Compara tamanho e SHA256 ao
manifesto gerado pelo script de exportacao. NAO comprova restaurabilidade.
#>
param(
  [string]$Pasta = 'D:\GuiaAndrelandiaBackupsPrivados\20261013T212912Z-34019e86'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$NomesEsperados = @(
  'roles.sql',
  'schema.sql',
  'data.sql',
  'auth_data.sql',
  'storage_metadata.sql',
  'history_schema.sql',
  'history_data.sql'
)

if (-not (Test-Path -LiteralPath $Pasta -PathType Container)) {
  throw 'PASTA_AUSENTE: diretorio de backup nao encontrado.'
}

$PastaCompleta = [System.IO.Path]::GetFullPath($Pasta)
$Unidade = [System.IO.Path]::GetPathRoot($PastaCompleta).TrimEnd('\')
if ($Unidade -cne 'D:') {
  throw 'DESTINO_INESPERADO: esta verificacao foi preparada para o backup em D:.'
}

$ManifestoPath = Join-Path $PastaCompleta 'manifesto.txt'
if (-not (Test-Path -LiteralPath $ManifestoPath -PathType Leaf)) {
  throw 'MANIFESTO_AUSENTE.'
}

$Linhas = @(Get-Content -LiteralPath $ManifestoPath -Encoding UTF8)
if (@($Linhas | Where-Object { $_ -ceq 'projeto=xdmbkflufsfqziixzpxc' }).Count -ne 1) {
  throw 'MANIFESTO_INVALIDO: projeto inesperado.'
}
if (@($Linhas | Where-Object { $_ -ceq 'estado=exportado_nao_restaurado' }).Count -ne 1) {
  throw 'MANIFESTO_INVALIDO: estado nao confirmado.'
}

# O manifesto possui exatamente sete linhas com nomes .sql, tamanhos e hashes.
$Registros = @($Linhas | Where-Object { $_ -match '^[^|]+\.sql\|' })
if ($Registros.Count -ne $NomesEsperados.Count) {
  throw 'MANIFESTO_INVALIDO: quantidade de arquivos SQL inesperada.'
}

foreach ($Nome in $NomesEsperados) {
  $Correspondentes = @($Registros | Where-Object {
    $_.StartsWith("$Nome|", [System.StringComparison]::Ordinal)
  })
  if ($Correspondentes.Count -ne 1) {
    throw "MANIFESTO_INVALIDO: registro ausente ou duplicado de $Nome"
  }
  $Padrao = '^' + [regex]::Escape($Nome) + '\|bytes=([0-9]+)\|sha256=([0-9a-fA-F]{64})$'
  $Match = [regex]::Match($Correspondentes[0], $Padrao)
  if (-not $Match.Success) {
    throw "MANIFESTO_INVALIDO: registro malformado de $Nome"
  }

  $TamanhoEsperado = [long]::Parse($Match.Groups[1].Value)
  $HashEsperado = $Match.Groups[2].Value
  $Caminho = Join-Path $PastaCompleta $Nome
  if (-not (Test-Path -LiteralPath $Caminho -PathType Leaf)) {
    throw "ARQUIVO_AUSENTE: $Nome"
  }
  $Item = Get-Item -LiteralPath $Caminho
  if ($TamanhoEsperado -lt 64 -or $Item.Length -ne $TamanhoEsperado) {
    throw "TAMANHO_DIVERGENTE: $Nome"
  }
  $HashAtual = (Get-FileHash -LiteralPath $Caminho -Algorithm SHA256).Hash
  if ($HashAtual -ine $HashEsperado) {
    throw "HASH_DIVERGENTE: $Nome"
  }
}

Write-Host 'INTEGRIDADE_LOCAL_OK: 7 arquivos conferidos contra manifesto.txt.'
Write-Host 'AVISO: hashes validos nao comprovam restauracao. Nao compartilhar arquivos SQL.'
