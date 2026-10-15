<#
COB-06: verifica copia JA EXISTENTE do backup SQL em USB/SD cifrado.
SOMENTE LEITURA: nao copia, apaga, cria, repara, monta, formata ou desbloqueia.
Nao imprime conteudo SQL, manifesto, hashes, numero de serie ou credenciais.
Nao comprova backup de bytes Storage, bundles Edge, segredos ou restauracao.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$PastaExterna,
  [string]$PastaOrigem = 'D:\GuiaAndrelandiaBackupsPrivados\20261013T212912Z-34019e86'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Exigir-DiretorioSemRedirecionamento([string]$Caminho) {
  if (-not (Test-Path -LiteralPath $Caminho -PathType Container)) {
    throw 'COPIA_AUSENTE: pasta nao localizada.'
  }
  $Atual = [System.IO.Path]::GetFullPath($Caminho).TrimEnd('\')
  while ($Atual -and (Test-Path -LiteralPath $Atual)) {
    $Item = Get-Item -LiteralPath $Atual -Force
    if (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'CAMINHO_REDIRECIONADO: junction ou symlink nao aceito.'
    }
    $Pai = [System.IO.Directory]::GetParent($Atual)
    if ($null -eq $Pai) { break }
    $Atual = $Pai.FullName.TrimEnd('\')
    if ($Atual -match '^[A-Za-z]:$') { $Atual += '\' }
  }
}

$Origem = [System.IO.Path]::GetFullPath($PastaOrigem)
$Destino = [System.IO.Path]::GetFullPath($PastaExterna)
$RaizOrigem = [System.IO.Path]::GetPathRoot($Origem)
$RaizDestino = [System.IO.Path]::GetPathRoot($Destino)
if ($RaizOrigem -ine 'D:\' -or $RaizDestino -notmatch '^[A-Za-z]:\\$' -or
    $RaizDestino -ieq $RaizOrigem) {
  throw 'UNIDADES_INVALIDAS: origem D: e copia em outra unidade local obrigatorias.'
}
Exigir-DiretorioSemRedirecionamento $Origem
Exigir-DiretorioSemRedirecionamento $Destino

$LetraOrigem = $RaizOrigem.Substring(0,1)
$LetraDestino = $RaizDestino.Substring(0,1)
try {
  $ParticaoOrigem = Get-Partition -DriveLetter $LetraOrigem -ErrorAction Stop
  $ParticaoDestino = Get-Partition -DriveLetter $LetraDestino -ErrorAction Stop
  $DiscoOrigem = Get-Disk -Number $ParticaoOrigem.DiskNumber -ErrorAction Stop
  $DiscoDestino = Get-Disk -Number $ParticaoDestino.DiskNumber -ErrorAction Stop
} catch {
  throw 'DISCO_NAO_VERIFICADO: impossivel comprovar independencia fisica.'
}
if ($DiscoOrigem.Number -eq $DiscoDestino.Number -or
    @('USB','SD') -notcontains [string]$DiscoDestino.BusType) {
  throw 'COPIA_NAO_INDEPENDENTE: exige USB/SD em disco fisico diferente.'
}
try {
  $Bitlocker = Get-BitLockerVolume -MountPoint ($LetraDestino + ':') -ErrorAction Stop
} catch {
  throw 'BITLOCKER_NAO_VERIFICADO: copia externa nao validada.'
}
if ([string]$Bitlocker.VolumeStatus -ne 'FullyEncrypted' -or
    [string]$Bitlocker.ProtectionStatus -ne 'On' -or
    [int]$Bitlocker.EncryptionPercentage -ne 100 -or
    [string]$Bitlocker.LockStatus -ne 'Unlocked') {
  throw 'BITLOCKER_INSUFICIENTE: exige 100 por cento, protecao ativa e unidade desbloqueada.'
}

# A fonte precisa coincidir com o manifesto original ANTES da comparacao.
$ValidadorOrigem = Join-Path $PSScriptRoot 'asaas-cob06-verificar-integridade-local.ps1'
& $ValidadorOrigem -Pasta $Origem

$Arquivos = @('manifesto.txt','roles.sql','schema.sql','data.sql',
  'auth_data.sql','storage_metadata.sql','history_schema.sql','history_data.sql')
foreach ($Nome in $Arquivos) {
  $Fonte = Join-Path $Origem $Nome
  $Copia = Join-Path $Destino $Nome
  if (-not (Test-Path -LiteralPath $Copia -PathType Leaf)) {
    throw "COPIA_INCOMPLETA: $Nome"
  }
  $ItemDestino = Get-Item -LiteralPath $Copia -Force
  if (($ItemDestino.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "COPIA_REDIRECIONADA: $Nome"
  }
  if ((Get-Item -LiteralPath $Fonte).Length -ne $ItemDestino.Length) {
    throw "COPIA_TAMANHO_DIVERGENTE: $Nome"
  }
  $HashFonte = (Get-FileHash -LiteralPath $Fonte -Algorithm SHA256).Hash
  $HashCopia = (Get-FileHash -LiteralPath $Copia -Algorithm SHA256).Hash
  if ($HashFonte -ine $HashCopia) {
    throw "COPIA_HASH_DIVERGENTE: $Nome"
  }
}

Write-Host 'COB06_COPIA_EXTERNA_INTEGRA: manifesto e 7 SQL identicos em disco USB/SD independente cifrado.'
Write-Host 'LIMITE: nao comprova restauracao, bytes Storage, Edge Functions, configuracoes ou guarda externa da chave.'
