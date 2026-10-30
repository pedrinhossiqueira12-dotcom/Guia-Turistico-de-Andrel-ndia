<#
COB-06 — Recalcula a integridade de um backup Storage ja exportado.
SOMENTE LEITURA: nao conecta ao Supabase, nao copia, nao grava e nao apaga.
Nunca imprime caminhos individuais, hashes, conteudo dos arquivos ou credenciais.
Executar no PowerShell do Windows onde esta montada a unidade D: com BitLocker.
A conferência usa o manifesto SHA256 gravado no backup; nao prova autenticidade
externa do manifesto, copia em outra unidade ou recuperacao.
#>
param(
 [string]$DestinoSeguro='D:\GuiaAndrelandiaBackupsPrivados',
 [string]$PastaExportacao=''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Exigir([bool]$Ok,[string]$Codigo) {
 if (-not $Ok) { throw ('COB06_STORAGE_VERIFICACAO_BLOQUEADA: '+$Codigo) }
}
function Exigir-SemRedirecionamento([string]$Alvo) {
 $Atual=[IO.Path]::GetFullPath($Alvo)
 while ($Atual -and (Test-Path -LiteralPath $Atual)) {
  $Item=Get-Item -LiteralPath $Atual -Force
  Exigir (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'CAMINHO_REDIRECIONADO'
  $Pai=[IO.Directory]::GetParent($Atual)
  if ($null -eq $Pai) { break }
  $Atual=$Pai.FullName
 }
}
function Exigir-Arquivo([string]$Alvo) {
 Exigir (Test-Path -LiteralPath $Alvo -PathType Leaf) 'ARQUIVO_AUSENTE'
 $Item=Get-Item -LiteralPath $Alvo -Force
 Exigir (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'ARQUIVO_REDIRECIONADO'
 return $Item
}

$Base=[IO.Path]::GetFullPath($DestinoSeguro).TrimEnd('\')
Exigir ([IO.Path]::GetPathRoot($Base) -ieq 'D:\') 'UNIDADE_INCORRETA'
Exigir (Test-Path -LiteralPath $Base -PathType Container) 'DESTINO_AUSENTE'
Exigir-SemRedirecionamento $Base
Exigir ([bool](Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue)) 'BITLOCKER_NAO_AUDITAVEL'
$Volume=Get-BitLockerVolume -MountPoint 'D:' -ErrorAction Stop
Exigir ($null -ne $Volume -and [string]$Volume.ProtectionStatus -eq 'On' -and
 [string]$Volume.VolumeStatus -eq 'FullyEncrypted' -and
 [int]$Volume.EncryptionPercentage -eq 100 -and
 [string]$Volume.LockStatus -eq 'Unlocked') 'BITLOCKER_INSUFICIENTE'

if ($PastaExportacao) {
 $Raiz=[IO.Path]::GetFullPath($PastaExportacao).TrimEnd('\')
 Exigir ($Raiz.StartsWith($Base+'\',[StringComparison]::OrdinalIgnoreCase)) 'EXPORTACAO_FORA_DA_BASE'
} else {
 $Candidatas=@(Get-ChildItem -LiteralPath $Base -Directory -Filter 'storage-cob06-*' -Force |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'EXPORTACAO_STORAGE_CONFERIDA.txt') -PathType Leaf } |
  Sort-Object LastWriteTime -Descending)
 Exigir ($Candidatas.Count -ge 1) 'NENHUMA_EXPORTACAO_CONCLUIDA'
 $Raiz=$Candidatas[0].FullName
}
Exigir (Test-Path -LiteralPath $Raiz -PathType Container) 'PASTA_EXPORTACAO_AUSENTE'
Exigir-SemRedirecionamento $Raiz
Exigir (-not (Test-Path -LiteralPath (Join-Path $Raiz 'ESTADO_INCOMPLETO.txt'))) 'EXPORTACAO_MARCADA_INCOMPLETA'
$Selo=Join-Path $Raiz 'EXPORTACAO_STORAGE_CONFERIDA.txt'
$Manifesto=Join-Path $Raiz 'sha256-storage.csv'
$Dados=Join-Path $Raiz 'files'
$null=Exigir-Arquivo $Selo
$null=Exigir-Arquivo $Manifesto
Exigir (Test-Path -LiteralPath $Dados -PathType Container) 'DADOS_AUSENTES'
Exigir-SemRedirecionamento $Dados
$SeloTexto=Get-Content -LiteralPath $Selo -Raw -Encoding UTF8
Exigir ($SeloTexto -match 'Objetos: 128; buckets: 5; bytes: 133855024') 'SELO_INESPERADO'
Exigir ($SeloTexto -match 'Projeto conferido: xdmbkflufsfqziixzpxc') 'PROJETO_INCORRETO'

$Esperado=@{
 'cadastros'=@{contagem=99;bytes=107180184L}
 'catalogos'=@{contagem=6;bytes=522686L}
 'mural-imagens'=@{contagem=8;bytes=13358595L}
 'noticias-eventos'=@{contagem=7;bytes=5083718L}
 'perfil-fotos'=@{contagem=8;bytes=7709841L}
}
$Linhas=@(Import-Csv -LiteralPath $Manifesto -Encoding UTF8)
Exigir ($Linhas.Count -eq 128) 'MANIFESTO_CONTAGEM_INCORRETA'
$Vistos=@{}
$Totais=@{}
foreach($Bucket in $Esperado.Keys) {
 $Totais[$Bucket]=@{contagem=0;bytes=0L}
 $PastaBucket=Join-Path $Dados $Bucket
 Exigir (Test-Path -LiteralPath $PastaBucket -PathType Container) 'BUCKET_LOCAL_AUSENTE'
 Exigir-SemRedirecionamento $PastaBucket
}
# Mesmo uma pasta intermediaria nao pode ser junction/symlink.
foreach($Dir in @(Get-ChildItem -LiteralPath $Dados -Directory -Recurse -Force)) {
 Exigir (($Dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'DIRETORIO_INTERMEDIARIO_REDIRECIONADO'
}
foreach($Linha in $Linhas) {
 $Rel=[string]$Linha.CaminhoRelativo
 $Sha=[string]$Linha.SHA256
 Exigir (-not [string]::IsNullOrWhiteSpace($Rel) -and
  -not [IO.Path]::IsPathRooted($Rel) -and
  -not $Rel.Contains('/') -and -not $Rel.Contains(':')) 'CAMINHO_MANIFESTO_INVALIDO'
 $Partes=@($Rel -split '\\')
 Exigir ($Partes.Count -ge 2 -and
  @($Partes | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }).Count -eq 0) 'CAMINHO_MANIFESTO_INVALIDO'
 $Bucket=$Partes[0]
 Exigir ($Esperado.ContainsKey($Bucket)) 'BUCKET_MANIFESTO_DESCONHECIDO'
 Exigir (-not $Vistos.ContainsKey($Rel)) 'CAMINHO_DUPLICADO'
 Exigir ($Sha -cmatch '^[0-9A-Fa-f]{64}$') 'HASH_MANIFESTO_INVALIDO'
 $Tamanho=0L
 Exigir ([long]::TryParse([string]$Linha.Bytes,[ref]$Tamanho) -and $Tamanho -ge 0) 'BYTES_MANIFESTO_INVALIDOS'
 $Alvo=[IO.Path]::GetFullPath((Join-Path $Dados $Rel))
 Exigir ($Alvo.StartsWith($Dados.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) 'CAMINHO_FORA_DOS_DADOS'
 $Arquivo=Exigir-Arquivo $Alvo
 Exigir ($Arquivo.Length -eq $Tamanho) 'TAMANHO_DIVERGENTE'
 $HashAtual=(Get-FileHash -LiteralPath $Alvo -Algorithm SHA256).Hash
 Exigir ($HashAtual -ieq $Sha) 'SHA256_DIVERGENTE'
 $Vistos[$Rel]=$true
 $Totais[$Bucket].contagem++
 $Totais[$Bucket].bytes+=$Tamanho
}
foreach($Bucket in $Esperado.Keys) {
 Exigir ($Totais[$Bucket].contagem -eq $Esperado[$Bucket].contagem -and
  $Totais[$Bucket].bytes -eq $Esperado[$Bucket].bytes) 'INVENTARIO_BUCKET_DIVERGENTE'
}
$Todos=@(Get-ChildItem -LiteralPath $Dados -Recurse -File -Force)
Exigir ($Todos.Count -eq 128) 'ARQUIVOS_EXTRAS_OU_AUSENTES'
foreach($Arquivo in $Todos) {
 Exigir (($Arquivo.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'ARQUIVO_REDIRECIONADO'
 $Rel=$Arquivo.FullName.Substring($Dados.Length).TrimStart('\')
 Exigir ($Vistos.ContainsKey($Rel)) 'ARQUIVO_FORA_DO_MANIFESTO'
}
Write-Host 'COB06_STORAGE_INTEGRIDADE_INDEPENDENTE_OK: 5 buckets, 128 arquivos, 133855024 bytes; 128 SHA256 recalculados.'
Write-Host 'SOMENTE LEITURA. Nao houve rede, copia, restauracao ou mudanca em producao.'
Write-Host 'PENDENTE: segunda copia em disco fisico externo cifrado e teste de recuperacao.'
