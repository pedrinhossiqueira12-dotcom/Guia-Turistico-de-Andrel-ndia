<#
COB-06 — Backup MANUAL da base de producao no plano Free.
Modo Verificar (padrao): NENHUMA conexao, NENHUM backup.
Modo Executar: solicitacao explicita, dump somente-leitura com Supabase CLI.
ATENCAO: arquivos SQL conteem dados pessoais e possiveis dados sensiveis.
Nunca enviar a GitHub, chat, email ou pasta compartilhada sem criptografia.
Isto NAO faz backup dos bytes de fotos no Storage, Edge, secrets ou PITR.
Documentacao: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
#>
param(
  [ValidateSet('Verificar','Executar')]
  [string]$Modo = 'Verificar',
  [string]$DestinoSeguro = ''
)
$ErrorActionPreference='Stop'
$ProjectRef='xdmbkflufsfqziixzpxc'
$StoreRoot=if ([string]::IsNullOrWhiteSpace($DestinoSeguro)) {
  Join-Path $HOME 'GuiaAndrelandiaBackupsPrivados'
} else {
  Join-Path $DestinoSeguro 'GuiaAndrelandiaBackupsPrivados'
}
$Workspace=Join-Path $StoreRoot '_cli_workspace'

function Validar-Volume-Seguro([string]$Caminho) {
  # FAIL CLOSED: nunca escrever o dump em disco sem criptografia ativa.
  $CaminhoAbsoluto=[System.IO.Path]::GetFullPath($Caminho)
  $Raiz=[System.IO.Path]::GetPathRoot($CaminhoAbsoluto)
  if (-not $Raiz -or $Raiz.StartsWith('\\')) {
    throw 'Backup em caminho de rede/UNC nao permitido: use unidade local criptografada.'
  }
  $Unidade=$Raiz.TrimEnd('\')
  if (-not (Get-Command 'Get-BitLockerVolume' -ErrorAction SilentlyContinue)) {
    throw 'Nao foi possivel auditar BitLocker. Nenhuma exportacao realizada; consulte o runbook.'
  }
  try {
    $Volume=Get-BitLockerVolume -MountPoint $Unidade -ErrorAction Stop
  } catch {
    throw "Nao foi possivel conferir criptografia na unidade $Unidade. Backup bloqueado."
  }
  if (-not $Volume -or [string]$Volume.ProtectionStatus -ne 'On' -or
      [string]$Volume.VolumeStatus -ne 'FullyEncrypted' -or
      [int]$Volume.EncryptionPercentage -ne 100) {
    throw "BACKUP_BLOQUEADO: unidade $Unidade sem BitLocker 100% ativo. Nao exportar SQL com dados pessoais."
  }
  Write-Host "DESTINO_SEGURO: unidade $Unidade criptografada, 100%, protecao ativa."
}

function Validar-Credencial-Nativa {
  # A Supabase CLI armazena token no gerenciador nativo do Windows. Se isso
  # falhar, pode cair em arquivo claro no C: ($HOME\.supabase\access-token).
  $TokenTexto=Join-Path $HOME '.supabase\access-token'
  if (Test-Path -LiteralPath $TokenTexto -PathType Leaf) {
    throw 'CREDENCIAIS_INSEGURAS: token da Supabase CLI armazenado em texto puro no perfil Windows (C:). Nao executar dump. Nunca mostrar ou enviar o conteudo deste arquivo.'
  }
}

function Requer-Comando([string]$Nome) {
  if (-not (Get-Command $Nome -ErrorAction SilentlyContinue)) {
    throw "Dependencia ausente: $Nome. Instale a versao oficial antes de prosseguir."
  }
}
function Executar-CLI([string[]]$Argumentos,[string]$Etapa) {
  & supabase @Argumentos
  if ($LASTEXITCODE -ne 0) {
    throw "Supabase CLI falhou em $Etapa. Nenhum restore foi realizado; nao usar arquivos parciais."
  }
}
function Validar-Arquivo([string]$Caminho) {
  if (-not (Test-Path -LiteralPath $Caminho -PathType Leaf)) {
    throw "Arquivo de exportacao ausente. Backup INCOMPLETO."
  }
  $file=Get-Item -LiteralPath $Caminho
  if ($file.Length -lt 64) { throw "Exportacao vazia/truncada. Backup INCOMPLETO." }
}
Requer-Comando 'supabase'
Requer-Comando 'docker'
& supabase --version
if ($LASTEXITCODE -ne 0) { throw 'Supabase CLI nao executou.' }
& docker info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop precisa estar iniciado.' }

if ($Modo -eq 'Verificar') {
  if (-not [string]::IsNullOrWhiteSpace($DestinoSeguro)) {
    Validar-Volume-Seguro -Caminho $StoreRoot
  }
  Write-Host 'PREFLIGHT_OK: Supabase CLI e Docker Desktop estao disponiveis.'
  Write-Host 'Nenhuma conexao ao banco ou alteracao foi feita.'
  Write-Host 'Leia o runbook COB-06. Os dados serao salvos apenas em pasta privada local.'
  return
}

Validar-Volume-Seguro -Caminho $StoreRoot
Validar-Credencial-Nativa

Write-Warning 'PRODUCAO: este comando LERA usuarios, dados financeiros e configuracoes.'
Write-Warning 'Exige computador protegido e disco criptografado (BitLocker ou equivalente).'
Write-Warning 'Nao executar dentro de repositorio Git, pasta publica ou pasta sincronizada sem criptografia ponta-a-ponta.'
Write-Warning 'O dump SQL NAO inclui arquivos fisicos do Storage, secrets, Edge nem restauracao testada.'
$Confirmacao=Read-Host 'Digite BACKUP-FREE-PRODUCAO para autorizar SOMENTE exportacao'
if ($Confirmacao -cne 'BACKUP-FREE-PRODUCAO') { throw 'Exportacao cancelada. Nenhuma operacao remota.' }

$NomeBackup=(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$Output=Join-Path $StoreRoot $NomeBackup
$gitDir=Join-Path $StoreRoot '.git'
if (Test-Path -LiteralPath $gitDir) { throw 'Pasta de backup nao pode ser repositorio Git.' }
# Impedir pasta de backup sob repositorio Git em qualquer diretorio ancestral.
$Ancestor=Get-Item -LiteralPath (Split-Path -Parent $StoreRoot) -ErrorAction SilentlyContinue
while ($null -ne $Ancestor) {
  if (Test-Path -LiteralPath (Join-Path $Ancestor.FullName '.git')) {
    throw 'Backup dentro de repositorio Git: altere o diretorio de destino.'
  }
  $Ancestor=$Ancestor.Parent
}
New-Item -ItemType Directory -Path $Output -Force | Out-Null
New-Item -ItemType Directory -Path $Workspace -Force | Out-Null
# Evitar temporarios do cliente PowerShell/CLI no C: quando destino e D: protegido.
# ATENCAO: este ajuste NAO move automaticamente o disco interno do Docker Desktop
# nem o repositorio de credenciais da Supabase CLI. Verificar ambos no Windows.
$TempSeguro=Join-Path $Workspace '_temporarios'
New-Item -ItemType Directory -Path $TempSeguro -Force | Out-Null
$OldTEMP=$env:TEMP
$OldTMP=$env:TMP
$OldTMPDIR=$env:TMPDIR
$env:TEMP=$TempSeguro
$env:TMP=$TempSeguro
$env:TMPDIR=$TempSeguro
$Phase='inicializacao'
Push-Location $Workspace
try {
  if (-not (Test-Path -LiteralPath (Join-Path $Workspace 'supabase\config.toml'))) {
    Executar-CLI -Argumentos @('init') -Etapa 'supabase init local' 
  }
  Write-Host 'Entre no Supabase com sua conta local, quando solicitado. Nao cole token no chat.'
  Executar-CLI -Argumentos @('login') -Etapa 'autenticacao local'
  Validar-Credencial-Nativa
  Executar-CLI -Argumentos @('link','--project-ref',$ProjectRef) -Etapa 'vinculo local somente leitura'
  $LinkRefFile=Join-Path $Workspace 'supabase\.temp\project-ref'
  if (-not (Test-Path -LiteralPath $LinkRefFile -PathType Leaf)) {
    throw 'Vinculo de projeto nao comprovado pela CLI: abortar antes de exportar.'
  }
  $LinkedRef=(Get-Content -LiteralPath $LinkRefFile -Raw).Trim()
  if ($LinkedRef -cne $ProjectRef) {
    throw 'CLI vinculada a projeto inesperado. Nenhum dump executado.'
  }
  $Files=@(
    @{file='roles.sql';args=@('--role-only')},
    @{file='schema.sql';args=@()},
    @{file='data.sql';args=@('--use-copy','--data-only','-x','storage.buckets_vectors','-x','storage.vector_indexes')},
    # Os dumps acima excluem auth/storage por padrao. Preservar DADOS gerenciados
    # explicitamente para eventual recuperacao, SEM tentar restaurar automaticamente.
    @{file='auth_data.sql';args=@('--use-copy','--data-only','--schema','auth')},
    @{file='storage_metadata.sql';args=@('--use-copy','--data-only','--schema','storage','-x','storage.buckets_vectors','-x','storage.vector_indexes')},
    @{file='history_schema.sql';args=@('--schema','supabase_migrations')},
    @{file='history_data.sql';args=@('--use-copy','--data-only','--schema','supabase_migrations')}
  )
  foreach ($item in $Files) {
    $Phase=$item.file
    $target=Join-Path $Output $item.file
    $args=@('db','dump','--linked','--file',$target)+$item.args
    Executar-CLI -Argumentos $args -Etapa $Phase
    Validar-Arquivo $target
    if ($item.file -eq 'auth_data.sql' -and -not
        (Select-String -LiteralPath $target -Pattern '^COPY[ ]+("?auth"?)[.]("?users"?)\b' -Quiet)) {
      throw 'auth_data.sql nao contem COPY auth.users. Backup INCOMPLETO.'
    }
    if ($item.file -eq 'storage_metadata.sql' -and -not
        (Select-String -LiteralPath $target -Pattern '^COPY[ ]+("?storage"?)[.]("?objects"?)\b' -Quiet)) {
      throw 'storage_metadata.sql nao contem COPY storage.objects. Backup INCOMPLETO.'
    }
  }
  # PowerShell 5.1: NAO usar @('texto'+$var, 'texto'+$var, ...)
  # pois a precedencia de operadores pode concatenar campos numa unica linha.
  # Cada campo deve ser adicionado separadamente ao array.
  $Manifest = @()
  $Manifest += ('projeto={0}' -f $ProjectRef)
  $Manifest += ('gerado_utc={0}' -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))
  $Manifest += 'tipo=exportacao_sql_logica_manual'
  $Manifest += 'estado=exportado_nao_restaurado'
  $Manifest += 'limite=exportacoes sequenciais sem snapshot global entre os arquivos SQL'
  $Manifest += 'AVISO=auth/storage contem dados gerenciados; restauracao exige plano e validacao separada'
  $Manifest += 'AVISO=SEM bytes de Storage, secrets e bundles de Edge; exige teste de restore'
  foreach ($item in $Files) {
    $file=Join-Path $Output $item.file
    $hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    $size=(Get-Item -LiteralPath $file).Length
    $Manifest+=('{0}|bytes={1}|sha256={2}' -f $item.file,$size,$hash)
  }
  $Manifest | Set-Content -LiteralPath (Join-Path $Output 'manifesto.txt') -Encoding UTF8
  Write-Host 'EXPORTACAO_CONCLUIDA: sete arquivos SQL criados e hash SHA256 conferido.'
  Write-Host 'Estado: apenas exportado, RESTAURACAO AINDA NAO VALIDADA.'
  Write-Host 'Guarde em midia criptografada offline/externa; nunca envie os arquivos ao GitHub ou chat.'
} catch {
  Write-Warning ("EXPORTACAO_INCOMPLETA na etapa: "+$Phase)
  Write-Warning 'Arquivos parciais devem ser tratados como DADOS SENSIVEIS e nao como backup valido.'
  throw
} finally {
  Pop-Location
  $env:TEMP=$OldTEMP
  $env:TMP=$OldTMP
  $env:TMPDIR=$OldTMPDIR
}
