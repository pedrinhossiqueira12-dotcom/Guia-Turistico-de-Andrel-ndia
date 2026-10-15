# COB-06: ensaio SQL local do pacote de cobrancas, SEM COMMIT e SEM rede.
# Baixa apenas os arquivos SQL publicos de um commit GitHub imutavel.
$ErrorActionPreference = 'Stop'
$nome = 'guia-postgres-offline-20261014'
$volume = 'guia_pg_clone_offline_20261014'
$imagem = 'public.ecr.aws/supabase/postgres:17.11.0.002'
$ref = '8b07f9b756473b59c5aa5bbef944525706db50de'
$base = 'https://raw.githubusercontent.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia'
$pasta = 'D:\GuiaAndrelandiaRestauracaoLocal\cob06-ensaio-offline'
$fontes = @(
 'supabase/production-candidate/01_asaas_cobrancas_inbox_sem_saques.sql',
 'supabase/production-candidate/02_termos_encerramento_sem_saques.sql',
 'supabase/pending-migrations/20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql',
 'supabase/pending-migrations/20261009163000_impedir_reabertura_encerramento.sql',
 'supabase/pending-migrations/20261009180000_status_publicacao_publica_restrita.sql',
 'supabase/pending-migrations/20261009183000_proteger_republicacao_legada_apos_encerramento.sql',
 'supabase/pending-migrations/20261009184000_bloquear_despublicacao_legada_qualquer_status.sql',
 'supabase/pending-migrations/20261012104000_cob04_fechamento_apenas_entregas_confirmadas.sql',
 'supabase/pending-migrations/20261012163000_cob04_pagamento_somente_componentes_da_fatura.sql'
)
$nl = [Environment]::NewLine

Write-Host '=== PREFLIGHT CLONE ==='
$ins = @(docker inspect $nome 2>$null | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $ins.Count -ne 1) { throw 'Clone nao encontrado.' }
$c = $ins[0]
if (-not $c.State.Running -or $c.HostConfig.NetworkMode -ne 'none' -or $c.Config.Image -ne $imagem) {
 throw 'Clone, rede ou imagem inesperados.'
}
$volumeOk = @($c.Mounts | Where-Object {
 $_.Name -eq $volume -and $_.Destination -eq '/var/lib/postgresql/data' -and $_.Type -eq 'volume'
})
if ($volumeOk.Count -ne 1) { throw 'Volume de destino incorreto.' }
if ($c.HostConfig.PortBindings -and @($c.HostConfig.PortBindings.PSObject.Properties).Count -gt 0) {
 throw 'Contêiner com portas publicadas.'
}
$originaisAtivos = @(docker ps --format '{{.Names}}' | Where-Object { $_ -like '*auth-storage-20261014*' })
if ($LASTEXITCODE -ne 0 -or $originaisAtivos.Count -gt 0) { throw 'Supabase original esta ativo.' }
$sqlEstado = @'
SELECT (SELECT count(*) FROM pg_tables WHERE schemaname='public') || '|' ||
 (SELECT count(*) FROM auth.users) || '|' ||
 (SELECT count(*) FROM storage.objects) || '|' ||
 (SELECT count(*) FROM supabase_migrations.schema_migrations) || '|' ||
 CASE WHEN to_regclass('public.catalogo_asaas_emissoes') IS NULL
 THEN 'ausente' ELSE 'presente' END;
'@
$antes = @(docker exec $nome psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c $sqlEstado)
if ($LASTEXITCODE -ne 0 -or $antes.Count -ne 1 -or $antes[0].Trim() -ne '38|3|128|29|ausente') {
 throw ('Estado inicial inesperado: ' + ($antes -join ' '))
}
Write-Host ('Estado inicial: ' + $antes[0])

Write-Host '=== CARREGAR SQL DO COMMIT FIXO ==='
New-Item -Path $pasta -ItemType Directory -Force | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$partes = [System.Collections.Generic.List[string]]::new()
for($i=0; $i -lt $fontes.Count; $i++) {
 $url = $base + '/' + $ref + '/' + $fontes[$i]
 $local = Join-Path $pasta ('fonte_{0:D2}.sql' -f ($i+1))
 Invoke-WebRequest -Uri $url -OutFile $local -UseBasicParsing
 $txt = [System.IO.File]::ReadAllText($local,[Text.Encoding]::UTF8)
 if ($txt.Length -lt 500 -or $txt -match '(?m)^[ \t]*\\') { throw ('SQL inesperado: ' + $fontes[$i]) }
 $b = [regex]::Matches($txt,'(?m)^[ \t]*BEGIN;[ \t]*\r?$').Count
 $e = [regex]::Matches($txt,'(?m)^[ \t]*COMMIT;[ \t]*\r?$').Count
 $esperado = if($i -lt 7){1}else{0}
 if($b -ne $esperado -or $e -ne $esperado) {
  throw ('Limites transacionais inesperados: ' + $fontes[$i])
 }
 $txt = [regex]::Replace($txt,'(?m)^[ \t]*(BEGIN|COMMIT);[ \t]*\r?$',
  '-- COB06 marcador de transacao removido para ROLLBACK unico')
 # Fonte 8 termina com um bloco de funcao sem ponto e virgula externo.
 # Acrescentar delimitador antes do SQL 9 ao combinar os arquivos.
 if ($i -eq 7 -and -not $txt.TrimEnd().EndsWith(';')) {
  $txt = $txt + $nl + ';' + $nl
 }
 $partes.Add($nl + '-- FONTE ' + ($i+1) + ': ' + $fontes[$i] + $nl + $txt + $nl)
 Write-Host ('Fonte ' + ($i+1) + '/9 verificada')
}

Write-Host '=== MONTAR TRANSACAO UNICA ==='
$abertura = @'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '180s';
SET LOCAL lock_timeout = '5s';
SELECT 'COB06_INICIO' AS marco;
'@
$auditoria = @'
DO $cob06$
DECLARE tab text; trg text; nome text;
BEGIN
 FOREACH tab IN ARRAY ARRAY[
  'catalogo_asaas_clientes','catalogo_asaas_emissoes',
  'catalogo_asaas_webhook_eventos','catalogo_cobranca_preferencias',
  'catalogo_aceites_operacionais','catalogo_encerramentos_comercio'
 ] LOOP
  IF to_regclass('public.' || tab) IS NULL THEN
   RAISE EXCEPTION 'COB06 tabela ausente: %',tab;
  END IF;
  IF NOT EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname=tab AND c.relrowsecurity
  ) THEN RAISE EXCEPTION 'COB06 sem RLS: %',tab; END IF;
 END LOOP;
 FOREACH trg IN ARRAY ARRAY[
  'catalogo_historico_guard_delete','catalogo_encerramento_sem_reabertura',
  'catalogo_publicacao_sem_divida_guard','catalogo_encerramento_sem_republicacao'
 ] LOOP
  IF NOT EXISTS (
   SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND t.tgname=trg
    AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
  ) THEN RAISE EXCEPTION 'COB06 trigger ausente: %',trg; END IF;
 END LOOP;
 FOREACH nome IN ARRAY ARRAY[
  'catalogo_asaas_registrar_fatura','catalogo_asaas_webhook_receber',
  'catalogo_asaas_webhook_claim','catalogo_asaas_webhook_finalizar',
  'catalogo_solicitar_encerramento_financeiro',
  'catalogo_finalizar_encerramento_financeiro'
 ] LOOP
  IF NOT EXISTS (
   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname=nome
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
  ) THEN RAISE EXCEPTION 'COB06 RPC ausente/exposta: %',nome; END IF;
 END LOOP;
 IF to_regclass('public.catalogo_asaas_saques') IS NOT NULL OR EXISTS(
   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
    AND p.proname IN ('catalogo_asaas_reservar_saque','catalogo_asaas_atualizar_saque')
 ) THEN RAISE EXCEPTION 'COB06 encontrou recursos de saque'; END IF;
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 29 THEN
  RAISE EXCEPTION 'COB06 historico de migrations alterado';
 END IF;
 RAISE NOTICE 'COB06_GATES_OK';
END $cob06$;
SELECT 'COB06_SQL_SEM_COMMIT' AS marco;
ROLLBACK;
SELECT 'COB06_ROLLBACK_OK' AS marco;
'@
$tudo = $abertura + $nl + ($partes -join $nl) + $nl + $auditoria
$arquivo = Join-Path $pasta 'ensaio.sql'
[IO.File]::WriteAllText($arquivo,$tudo,[Text.UTF8Encoding]::new($false))

Write-Host '=== EXECUTAR SOMENTE NO CLONE OFFLINE ==='
docker cp $arquivo ('{0}:/tmp/guia_cob06_ensaio.sql' -f $nome) | Out-Null
if($LASTEXITCODE -ne 0){throw 'Falha ao copiar SQL para contêiner offline.'}
$saida = @(docker exec $nome psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/guia_cob06_ensaio.sql 2>&1)
$codigo = $LASTEXITCODE
$log = Join-Path $pasta 'resultado-local.log'
$saida | ForEach-Object { [string]$_ } | Set-Content -LiteralPath $log -Encoding UTF8
Write-Host ('Codigo de saida SQL: ' + $codigo)
if($codigo -ne 0){
 Write-Host 'Transacao abortada sem COMMIT; log protegido no D:.'
 $saida | Select-Object -Last 6 | ForEach-Object { Write-Host ([string]$_) }
 throw 'Falha no pacote SQL: corrigir antes de continuar.'
}
$texto = ($saida | ForEach-Object { [string]$_ }) -join $nl
if(-not $texto.Contains('COB06_GATES_OK') -or -not $texto.Contains('COB06_ROLLBACK_OK')){
 throw 'Marcadores de ROLLBACK nao encontrados: nao declarar sucesso.'
}
Write-Host '=== CONFERIR BANCO DEPOIS DO ROLLBACK ==='
$depois = @(docker exec $nome psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c $sqlEstado)
if($LASTEXITCODE -ne 0 -or $depois.Count -ne 1 -or $depois[0].Trim() -ne $antes[0].Trim()){
 throw ('Estado depois inesperado: ' + ($depois -join ' '))
}
Write-Host ('Estado final: ' + $depois[0])
Write-Host 'COB06_PACOTE_SQL_CLONE_VALIDADO_COM_ROLLBACK'
Write-Host ('Log local: ' + $log)
