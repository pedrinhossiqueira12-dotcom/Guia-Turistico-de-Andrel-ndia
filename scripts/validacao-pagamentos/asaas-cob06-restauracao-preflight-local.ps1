<#
COB-06 — Preflight SOMENTE LEITURA do backup SQL REAL local.
Sem rede, sem Supabase remoto, sem conexao ao PostgreSQL, sem docker run.
Leitura local dos arquivos na unidade D: criptografada. NUNCA imprimir SQL.
Nao executa restore e nao altera o backup.
#>
param(
  [string]$Pasta = 'D:\GuiaAndrelandiaBackupsPrivados\20261013T212912Z-34019e86'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Exigir([bool]$Condicao, [string]$Codigo) {
  if (-not $Condicao) { throw "PREFLIGHT_BLOQUEADO: $Codigo" }
}

$PastaCompleta = [System.IO.Path]::GetFullPath($Pasta)
Exigir ($PastaCompleta.StartsWith('D:\GuiaAndrelandiaBackupsPrivados\', [System.StringComparison]::OrdinalIgnoreCase)) 'PASTA_INESPERADA'
Exigir (Test-Path -LiteralPath $PastaCompleta -PathType Container) 'BACKUP_AUSENTE'

try {
  $Vol = Get-BitLockerVolume -MountPoint 'D:' -ErrorAction Stop
} catch {
  throw 'PREFLIGHT_BLOQUEADO: FALHA_AO_CONSULTAR_BITLOCKER'
}
Exigir ([string]$Vol.VolumeStatus -eq 'FullyEncrypted' -and
  [string]$Vol.ProtectionStatus -eq 'On' -and
  [int]$Vol.EncryptionPercentage -eq 100) 'BITLOCKER_INATIVO'

$Verificador = Join-Path $PSScriptRoot 'asaas-cob06-verificar-integridade-local.ps1'
Exigir (Test-Path -LiteralPath $Verificador -PathType Leaf) 'VERIFICADOR_AUSENTE_EM_DOWNLOADS'
& $Verificador -Pasta $PastaCompleta | Out-Null
# O verificador dispara throw se hash/manifesto/tamanho nao conferir.

$Files = @('roles.sql','schema.sql','data.sql','auth_data.sql',
  'storage_metadata.sql','history_schema.sql','history_data.sql')
$TamanhoTotal = [long]0
foreach ($Name in $Files) {
  $Info = Get-Item -LiteralPath (Join-Path $PastaCompleta $Name) -ErrorAction Stop
  $TamanhoTotal += [long]$Info.Length
}

# Revisao somente de DDL e papeis. Os arquivos data-only contem linhas de
# dados pessoais e nao devem ser impressos ou interpretados como SQL DDL.
$Revisar = @('roles.sql','schema.sql','history_schema.sql')
$Riscos = @{
  ReferenciaCron = $false
  ReferenciaRede = $false
  ReferenciaVault = $false
  ShellOuProgram = $false
}
$Padroes = @{
  ReferenciaCron = '(?i)\b(?:pg_cron|cron\.(?:schedule|job|unschedule|alter_job|run_job))\b'
  ReferenciaRede = '(?i)\b(?:pg_net|net\.http_(?:post|get|delete)|dblink|postgres_fdw|http_post|http_get)\b'
  ReferenciaVault = '(?i)\b(?:vault\.|vault_secrets|supabase_vault)\b'
  ShellOuProgram = '(?i)^\s*(?:\\!|\\copy\b.*\bPROGRAM\b|COPY\b.*\bPROGRAM\b)'
}
foreach ($Nome in $Revisar) {
  $Leitor = [System.IO.StreamReader]::new((Join-Path $PastaCompleta $Nome))
  try {
    while ($null -ne ($Linha = $Leitor.ReadLine())) {
      foreach ($Campo in @('ReferenciaCron','ReferenciaRede','ReferenciaVault','ShellOuProgram')) {
        if (-not $Riscos[$Campo] -and [regex]::IsMatch($Linha,$Padroes[$Campo])) {
          $Riscos[$Campo] = $true
        }
      }
    }
  } finally {
    $Leitor.Dispose()
  }
}

# Inspecao do binario local Docker. Nunca pull, run ou altera containers.
$DockerDisponivel = $false
$ImagemDisponivel = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
  & docker info --format '{{.ServerVersion}}' 1>$null 2>$null
  $DockerDisponivel = ($LASTEXITCODE -eq 0)
  if ($DockerDisponivel) {
    & docker image inspect 'public.ecr.aws/supabase/postgres:17.6.1.166' 1>$null 2>$null
    $ImagemDisponivel = ($LASTEXITCODE -eq 0)
  }
}

Write-Host ('AUDITORIA_LOCAL_CONCLUIDA: manifesto e 7 arquivos conferidos; {0:N1} MiB SQL.' -f ($TamanhoTotal / 1MB))
Write-Host ('DOCKER_LOCAL: {0}; IMAGEM_PG17_LOCAL: {1}' -f $DockerDisponivel,$ImagemDisponivel)
Write-Host ('REFERENCIAS_DDL: Cron={0}; Rede={1}; Vault={2}; ShellOuProgram={3}' -f
  $Riscos.ReferenciaCron,$Riscos.ReferenciaRede,$Riscos.ReferenciaVault,$Riscos.ShellOuProgram)
if ($Riscos.ShellOuProgram) {
  Write-Host 'RESTAURACAO_BLOQUEADA: comando Shell/PROGRAM identificado; exige revisao de seguranca local.'
} elseif ($Riscos.ReferenciaCron -or $Riscos.ReferenciaRede -or $Riscos.ReferenciaVault) {
  Write-Host 'RESTAURACAO_PENDENTE_REVISAO: DDL contem referencias a jobs, rede ou Vault.'
} else {
  Write-Host 'RESTAURACAO_PENDENTE_REVISAO: scanner nao encontra referencias de risco no DDL; teste ainda nao autorizado.'
}
Write-Host 'RESTAURACAO_NAO_EXECUTADA: scanner le apenas DDL; nao comprova ausencia de efeitos em todos os dados.'
Write-Host 'Nenhuma conexao ao Supabase, nenhum dump regravado e nenhum dado pessoal exibido.'
