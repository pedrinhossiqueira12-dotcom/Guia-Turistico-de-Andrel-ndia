<#
COB-06 — Exportacao LOCAL dos bytes de Storage da PRODUCAO.
PADRAO Verificar: somente checagens locais, sem copia, sem rede.
Exportar: faz apenas download remoto (Supabase Storage CLI cp -r).
Nenhum arquivo e publicado em GitHub, enviado ao chat ou lido em stdout.
Nao restaura, deleta, atualiza Storage remoto nem emite Pix.
Requer Windows com BitLocker 100% ativo na unidade de destino e workspace.
O inventario abaixo e um SNAPSHOT somente leitura de 20/10/2026;
mudancas no Storage apos a captura bloqueiam o selo de integridade.
#>
param(
 [ValidateSet('Verificar','Exportar')]
 [string]$Modo='Verificar',
 [string]$Workspace='D:\GuiaAndrelandiaBackupsPrivados\_cli_workspace',
 [string]$DestinoSeguro='D:\GuiaAndrelandiaBackupsPrivados'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProjectRef='xdmbkflufsfqziixzpxc'

# Nao inclui caminhos de arquivos, contas ou identidades no codigo.
$Inventario=@(
 @{bucket='cadastros';quantidade=99;bytes=107180184L},
 @{bucket='catalogos';quantidade=6;bytes=522686L},
 @{bucket='mural-imagens';quantidade=8;bytes=13358595L},
 @{bucket='noticias-eventos';quantidade=7;bytes=5083718L},
 @{bucket='perfil-fotos';quantidade=8;bytes=7709841L}
)
function Exigir([bool]$Ok,[string]$Motivo) {
 if (-not $Ok) {throw ('STORAGE_BACKUP_BLOQUEADO: '+$Motivo)}
}
function Exigir-PastaCriptografada([string]$Pasta) {
 $Absoluto=[IO.Path]::GetFullPath($Pasta)
 $Drive=[IO.Path]::GetPathRoot($Absoluto)
 Exigir ([bool]($Drive -match '^[A-Za-z]:\\$')) 'EXIGE_VOLUME_LOCAL'
 Exigir ([bool](Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue)) 'BITLOCKER_NAO_AUDITAVEL'
 $v=Get-BitLockerVolume -MountPoint $Drive.TrimEnd('\') -ErrorAction Stop
 Exigir ($null -ne $v -and [string]$v.ProtectionStatus -eq 'On' -and
  [string]$v.VolumeStatus -eq 'FullyEncrypted' -and
  [int]$v.EncryptionPercentage -eq 100) 'DISCO_NAO_CRIPTOGRAFADO'
 $caminho=$Absoluto
 while ($caminho -and (Test-Path -LiteralPath $caminho)) {
  $item=Get-Item -LiteralPath $caminho -Force
  Exigir (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'DIRETORIO_REDIRECIONADO'
  $p=[IO.Directory]::GetParent($caminho)
  if ($null -eq $p) {break}
  $caminho=$p.FullName
 }
 return $Absoluto
}

$Workspace=Exigir-PastaCriptografada $Workspace
$DestinoSeguro=Exigir-PastaCriptografada $DestinoSeguro
Exigir (Test-Path -LiteralPath $Workspace -PathType Container) 'WORKSPACE_AUSENTE'
Exigir (Test-Path -LiteralPath $DestinoSeguro -PathType Container) 'DESTINO_AUSENTE'
Exigir (-not [IO.Path]::GetFullPath($DestinoSeguro).StartsWith(
  ([IO.Path]::GetFullPath($Workspace).TrimEnd('\')+'\'),
  [StringComparison]::OrdinalIgnoreCase)) 'DESTINO_DENTRO_WORKSPACE'
$RefFile=Join-Path $Workspace 'supabase\.temp\project-ref'
$ConfigFile=Join-Path $Workspace 'supabase\config.toml'
Exigir (Test-Path -LiteralPath $RefFile -PathType Leaf) 'PROJETO_NAO_VINCULADO'
Exigir (Test-Path -LiteralPath $ConfigFile -PathType Leaf) 'PROJETO_SEM_CONFIGURACAO'
Exigir ((Get-Content -LiteralPath $RefFile -Raw).Trim() -ceq $ProjectRef) 'PROJETO_INCORRETO'
# O project_id no config.toml e nome do projeto LOCAL; a identidade
# remota efetiva da CLI vinculada e .temp/project-ref, validada acima.
# Nao exigir que project_id (apelido local) seja igual ao ref remoto.
Exigir (-not (Test-Path -LiteralPath (Join-Path $HOME '.supabase\access-token') -PathType Leaf)) 'TOKEN_TEXTO_CLARO'

Exigir ([bool](Get-Command supabase -ErrorAction SilentlyContinue)) 'CLI_NAO_INSTALADA'
# A CLI deve suportar download remoto e os flags da referencia oficial.
$helpText=(& supabase storage cp --help 2>&1 | Out-String)
Exigir ($LASTEXITCODE -eq 0) 'CLI_STORAGE_CP_FALHOU'
Exigir ($helpText -match '(?i)recursive' -and $helpText -match '(?i)linked' -and
 $helpText -match '(?i)experimental') 'CLI_INCOMPATIVEL'
$MetaCount=[int](($Inventario|Measure-Object -Property quantidade -Sum).Sum)
$MetaBytes=[long](($Inventario|Measure-Object -Property bytes -Sum).Sum)
Exigir ($MetaCount -eq 128 -and $MetaBytes -eq 133855024) 'INVENTARIO_NAO_CONFERIDO'

if ($Modo -eq 'Verificar') {
 Write-Host 'COB06_STORAGE_PREFLIGHT_LOCAL_OK: projeto, criptografia e CLI conferidos.'
 Write-Host 'Inventario remoto de referencia: 5 buckets / 128 objetos.'
 Write-Host 'Nenhuma conexao para exportacao foi iniciada. Nenhum dado copiado.'
 return
}
$Confirmacao=Read-Host 'Digite EXPORTAR-STORAGE-PRODUCAO para baixar SOMENTE os arquivos'
Exigir ($Confirmacao -ceq 'EXPORTAR-STORAGE-PRODUCAO') 'OPERADOR_NAO_CONFIRMOU'

$Nome='storage-cob06-'+(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')+
 '-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$Raiz=Join-Path $DestinoSeguro $Nome
$Dados=Join-Path $Raiz 'files'
# Dados pessoais jamais podem ser gravados dentro de repositorio Git,
# mesmo que o destino seja fisicamente criptografado.
$cursor=Get-Item -LiteralPath $DestinoSeguro
while ($null -ne $cursor) {
 Exigir (-not (Test-Path -LiteralPath (Join-Path $cursor.FullName '.git')))
  'DESTINO_SOB_REPOSITORIO_GIT'
 $cursor=$cursor.Parent
}
Exigir (-not (Test-Path -LiteralPath $Raiz)) 'DESTINO_EXISTENTE'
New-Item -ItemType Directory -Path $Dados -Force | Out-Null
Set-Content -LiteralPath (Join-Path $Raiz 'ESTADO_INCOMPLETO.txt') -Value @(
 'Backup Storage INCOMPLETO ate todas as contagens, tamanhos e hashes conferidos.',
 'Nenhuma consulta/gravacao no banco remoto. Nenhum arquivo desta pasta deve ir para Git.'
 ) -Encoding UTF8

Push-Location $Workspace
try {
 foreach ($Entrada in $Inventario) {
  $Bucket=[string]$Entrada.bucket
  $Local=Join-Path $Dados $Bucket
  New-Item -ItemType Directory -Path $Local -Force | Out-Null
  # CLI somente DOWNLOADER: fonte sempre ss:///bucket, destino local absoluto.
  # Sem "mv", "rm" ou transferencia no sentido inverso.
  $args=@('storage','cp','--experimental','--linked','--recursive',
   ('ss:///'+$Bucket),$Local)
  & supabase @args *> (Join-Path $Raiz ('download-'+$Bucket+'.log'))
  Exigir ($LASTEXITCODE -eq 0) ('DOWNLOAD_FALHOU_'+$Bucket)
  $Objetos=@(Get-ChildItem -LiteralPath $Local -Recurse -File -Force)
  Exigir ($Objetos.Count -eq [int]$Entrada.quantidade) ('CONTAGEM_DIVERGENTE_'+$Bucket)
  $Bytes=[long](($Objetos|Measure-Object -Property Length -Sum).Sum)
  Exigir ($Bytes -eq [long]$Entrada.bytes) ('BYTES_DIVERGENTES_'+$Bucket)
  foreach($Obj in $Objetos) {
   Exigir (($Obj.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'ARQUIVO_REDIRECIONADO'
  }
 }
 # Manifesto individual: os nomes e os hashes ficam apenas no disco cifrado.
 $Resultado=New-Object System.Collections.Generic.List[object]
 foreach($Entrada in $Inventario) {
  $Bucket=[string]$Entrada.bucket
  $Local=Join-Path $Dados $Bucket
  foreach ($file in @(Get-ChildItem -LiteralPath $Local -Recurse -File -Force)) {
   $rel=$file.FullName.Substring($Dados.Length).TrimStart('\')
   $Resultado.Add([pscustomobject]@{
    CaminhoRelativo=$rel
    Bytes=[long]$file.Length
    SHA256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
   })
  }
 }
 Exigir ($Resultado.Count -eq 128) 'CONTAGEM_FINAL_DIVERGENTE'
 $Resultado|Export-Csv -LiteralPath (Join-Path $Raiz 'sha256-storage.csv') -Encoding UTF8 -NoTypeInformation
 # Selo de sucesso e criado somente quando todos os bytes do snapshot batem.
 Set-Content -LiteralPath (Join-Path $Raiz 'EXPORTACAO_STORAGE_CONFERIDA.txt') -Value @(
  'Projeto conferido: xdmbkflufsfqziixzpxc',
  'Snapshot de metadados em: 2026-10-20',
  'Objetos: 128; buckets: 5; bytes: 133855024',
  'Hashes individuais: sha256-storage.csv',
  'LIMITE: nao comprova copia externa, restore, segredo, Edge ou consistencia atomica.'
 ) -Encoding UTF8
 Remove-Item -LiteralPath (Join-Path $Raiz 'ESTADO_INCOMPLETO.txt') -Force
 Write-Host 'COB06_STORAGE_LOCAL_CONFERIDO: 5 buckets, 128 arquivos; SHA256 local registrado.'
 Write-Host 'ARQUIVOS PRIVADOS NA UNIDADE CRIPTOGRAFADA. Nao enviar ao GitHub nem chat.'
 Write-Host 'Ainda falta copia externa independente e teste de recuperacao.'
} catch {
 Write-Warning 'COB06_STORAGE_EXPORTACAO_PARCIAL: pasta privada permanece marcada INCOMPLETA.'
 throw
} finally {
 Pop-Location
}
