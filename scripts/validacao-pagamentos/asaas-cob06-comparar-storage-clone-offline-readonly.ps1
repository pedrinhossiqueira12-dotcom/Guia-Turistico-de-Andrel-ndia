<#
COB-06: compatibilidade entre storage.objects do clone SQL real (13/10) e
os bytes Storage extraidos do backup .7z (20/10).
SOMENTE LEITURA, inteiramente local, sem modificar banco, sem Git e sem rede.
Nunca imprime nomes de objetos, credenciais, arquivos privados ou metadados pessoais.
Os snapshots sao de dias diferentes: igualdade local nao comprova captura atomica.
Windows PowerShell 5.1; docker CLI local; contêiner previamente criado e isolado.
#>
param(
  [string]$Recuperado='D:\GuiaAndrelandiaBackupsPrivados\_teste_recuperacao_20261021\GuiaAndrelandia-Backup-20261020',
  [string]$Container='guia-postgres-offline-20261014'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Exigir([bool]$Ok,[string]$Erro) {
  if (-not $Ok) { throw ('COB06_METADATA_STORAGE_HOLD: '+$Erro) }
}
function Rodar-Docker([string[]]$ArgsDocker) {
  $antiga=$ErrorActionPreference
  try {
    # PowerShell 5.1 transforma avisos stderr de comandos nativos em ErrorRecord.
    $ErrorActionPreference='Continue'
    $saida=@(& docker @ArgsDocker 2>$null)
    $codigo=$LASTEXITCODE
  } finally {
    $ErrorActionPreference=$antiga
  }
  Exigir ($codigo -eq 0) 'DOCKER_FALHOU'
  return $saida
}
function De-Hex([string]$Texto) {
  Exigir (($Texto.Length % 2) -eq 0 -and $Texto -cmatch '^[a-fA-F0-9]*$') 'METADADO_HEX_INVALIDO'
  $bytes=New-Object byte[] ([int]($Texto.Length / 2))
  for ($i=0; $i -lt $bytes.Length; $i++) {
    $bytes[$i]=[Convert]::ToByte($Texto.Substring(2*$i,2),16)
  }
  return [Text.Encoding]::UTF8.GetString($bytes)
}
function Sem-Reparse([string]$Caminho) {
  Exigir (Test-Path -LiteralPath $Caminho) 'CAMINHO_AUSENTE'
  $item=Get-Item -LiteralPath $Caminho -Force
  Exigir (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'REDIRECIONAMENTO_NAO_PERMITIDO'
}
Exigir ([bool](Get-Command docker -ErrorAction SilentlyContinue)) 'DOCKER_NAO_ENCONTRADO'
Exigir ([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Recuperado)) -ieq 'D:\') 'DESTINO_NAO_E_D'
$v=Get-BitLockerVolume -MountPoint 'D:' -ErrorAction Stop
Exigir ($null -ne $v -and [string]$v.ProtectionStatus -eq 'On' -and
  [string]$v.VolumeStatus -eq 'FullyEncrypted') 'D_NAO_CRIPTOGRAFADO'
$root=[IO.Path]::GetFullPath($Recuperado).TrimEnd('\')
$dados=Join-Path $root 'storage-cob06-20261020T185621Z-afee4956\files'
$marcador=Join-Path $root 'storage-cob06-20261020T185621Z-afee4956\EXPORTACAO_STORAGE_CONFERIDA.txt'
$origemSQL=Join-Path $root '20261013T212912Z-34019e86'
Exigir (Test-Path -LiteralPath $marcador -PathType Leaf) 'STORAGE_NAO_CONFERIDO'
Exigir (Test-Path -LiteralPath $origemSQL -PathType Container) 'SQL_NAO_RECUPERADO'
Exigir (Test-Path -LiteralPath $dados -PathType Container) 'DADOS_STORAGE_NAO_ENCONTRADOS'
Sem-Reparse $root
Sem-Reparse $dados
Sem-Reparse $marcador
foreach($dir in @(Get-ChildItem -LiteralPath $dados -Recurse -Directory -Force)) {
  Exigir (($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'PASTA_STORAGE_REDIRECIONADA'
}
$ins=@(Rodar-Docker @('inspect',$Container))
Exigir ($ins.Count -gt 0) 'CONTAINER_NAO_ENCONTRADO'
$raw=$ins -join "`n"
try { $containerInfo=@($raw|ConvertFrom-Json) } catch { throw 'COB06_METADATA_STORAGE_HOLD: DOCKER_INSPECT_INVALIDO' }
Exigir ($containerInfo.Count -eq 1) 'DOCKER_INSPECT_AMBIGUO'
$ci=$containerInfo[0]
Exigir ($ci.State.Running -eq $true -and $ci.HostConfig.NetworkMode -ceq 'none') 'CLONE_NAO_ISOLADO'
Exigir ($ci.Config.Image -ceq 'public.ecr.aws/supabase/postgres:17.11.0.002') 'IMAGEM_INESPERADA'
$volume=@($ci.Mounts | Where-Object { $_.Name -eq 'guia_pg_clone_offline_20261014' -and
  $_.Destination -eq '/var/lib/postgresql/data' -and $_.Type -eq 'volume' })
Exigir ($volume.Count -eq 1) 'VOLUME_CLONE_INCORRETO'
if($ci.HostConfig.PortBindings) {
  Exigir (@($ci.HostConfig.PortBindings.PSObject.Properties).Count -eq 0) 'PORTAS_PUBLICADAS'
}
# Nao se imprimem valores individuais; usa-se HEX UTF-8 para representar
# nomes arbitrarios sem delimitadores, tabs ou quebras de linha nos resultados.
$sql=@'
SELECT encode(convert_to(bucket_id,'UTF8'),'hex') || '|' ||
       encode(convert_to(name,'UTF8'),'hex') || '|' ||
       COALESCE(metadata->>'size','-1')
  FROM storage.objects
 ORDER BY bucket_id,name;
'@
$linhas=@(Rodar-Docker @('exec',$Container,'psql','-X','-U','postgres','-d','postgres',
  '-At','-v','ON_ERROR_STOP=1','-c',$sql))
Exigir ($linhas.Count -eq 128) 'QUANTIDADE_METADATA_DIFERENTE_128'
$permitidos=@('cadastros','catalogos','mural-imagens','noticias-eventos','perfil-fotos')
$metadados=New-Object 'System.Collections.Generic.Dictionary[string,long]' ([StringComparer]::Ordinal)
$sizeVistos=0
foreach($linha in $linhas) {
  $campos=@([string]$linha -split '\|')
  Exigir ($campos.Count -eq 3) 'LINHA_SQL_INVALIDA'
  $bucket=De-Hex $campos[0]
  $nome=De-Hex $campos[1]
  Exigir (($permitidos -ccontains $bucket) -and -not [string]::IsNullOrWhiteSpace($nome)) 'BUCKET_OU_NOME_INVALIDO'
  Exigir (-not $nome.Contains('\') -and -not $nome.Contains(':')) 'SEPARADOR_INESPERADO'
  $partes=@($nome -split '/')
  Exigir (@($partes | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }).Count -eq 0) 'TRAVESSIA_DE_CAMINHO'
  $size=-1L
  Exigir ([long]::TryParse($campos[2],[ref]$size) -and $size -ge -1) 'TAMANHO_SQL_INVALIDO'
  $chave=$bucket+'/'+$nome
  Exigir (-not $metadados.ContainsKey($chave)) 'DUPLICIDADE_SQL'
  $metadados.Add($chave,$size)
  if($size -ge 0) { $sizeVistos++ }
}
$arquivos=@(Get-ChildItem -LiteralPath $dados -Recurse -File -Force)
Exigir ($arquivos.Count -eq 128) 'QUANTIDADE_ARQUIVOS_DIFERENTE_128'
$vistos=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
$bytes=0L
foreach($arq in $arquivos) {
  Exigir (($arq.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'ARQUIVO_REDIRECIONADO'
  $rel=$arq.FullName.Substring($dados.Length).TrimStart('\').Replace('\','/')
  Exigir ($metadados.ContainsKey($rel)) 'OBJETO_FISICO_SEM_METADATA'
  Exigir ($vistos.Add($rel)) 'CAMINHO_LOCAL_DUPLICADO'
  $tam=$metadados[$rel]
  if($tam -ge 0) { Exigir ($arq.Length -eq $tam) 'BYTES_SQL_VS_STORAGE_DIVERGENTES' }
  $bytes+=[long]$arq.Length
}
Exigir ($vistos.Count -eq $metadados.Count) 'OBJETO_METADATA_SEM_ARQUIVO'
Exigir ($bytes -eq 133855024L) 'BYTES_STORAGE_DIVERGENTES'
Write-Host ('COB06_METADATA_STORAGE_CLONE_COMPATIVEL: 128/128 arquivos, 5 buckets, {0} bytes, {1} tamanhos de metadata conferidos.' -f $bytes,$sizeVistos)
Write-Host 'SOMENTE LEITURA. SQL do clone offline e arquivos recuperados; sem rede, sem producao, sem escrita.'
Write-Host 'LIMITE: snapshots SQL 13/10 e Storage 20/10; nao comprova consistencia transacional ou backup integral dos servicos.'
