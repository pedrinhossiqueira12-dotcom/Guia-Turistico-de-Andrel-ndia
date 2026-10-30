#requires -Version 5.1
<#
COB-05 - ENSAIO NO ASAAS SANDBOX. NUNCA EXECUTAR COM A CHAVE DE PRODUCAO.
- Verificar: examina somente a configuracao do webhook de testes
- Clientes: mostra IDs/nomes de clientes no Sandbox sem CPF/email
- Criar: emite UMA cobranca PENDENTE de R$ 5,00 com referencia QA temporaria
- Liberar: corrige a referencia SOMENTE da cobranca ainda PENDENTE deste ensaio
Nao confirma pagamento, nao cria repasses, nao manipula webhook local.
A chave API e solicitada em prompt protegido e nao fica em arquivos/argumentos.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('Verificar','Clientes','Diagnosticar','Criar','Liberar')]
  [string]$Modo,
  [string]$ClienteId,
  [string]$CobrancaId
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$base = 'https://api-sandbox.asaas.com/v3'
$webhook = 'https://jbttwihctuibchhcyqtl.supabase.co/functions/v1/catalogo-asaas-financeiro/webhook'
$seguro = Read-Host 'Chave API exclusiva do Asaas SANDBOX (nao compartilhe)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
try {
  $chave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($chave)) { throw 'Chave vazia.' }
  $cabecalhos = @{ 'access_token' = $chave; 'accept'='application/json' }
  function Api([string]$Metodo,[string]$Caminho,$Corpo=$null) {
    $parametros = @{ Method=$Metodo; Uri=($base+$Caminho); Headers=$cabecalhos; TimeoutSec=20 }
    if ($null -ne $Corpo) {
      $parametros.ContentType='application/json'
      $parametros.Body=($Corpo | ConvertTo-Json -Depth 8 -Compress)
    }
    try { return Invoke-RestMethod @parametros }
    catch {
      # Exibir apenas status HTTP e codes conhecidos do Asaas, nunca corpo bruto ou headers.
      $http='desconhecido'
      try {
        if ($null -ne $_.Exception.Response) {
          $http=[string]([int]$_.Exception.Response.StatusCode)
        }
      } catch {}
      $codigos=@()
      try {
        $json=$_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction Stop
        foreach ($item in @($json.errors)) {
          if ($item.code -match '^[A-Za-z0-9_-]{1,70}$') { $codigos+= $item.code }
        }
      } catch {}
      $resumo=if($codigos.Count){($codigos | Select-Object -Unique)-join ','}else{'nao_disponivel'}
      throw ('Asaas Sandbox {0} {1}: HTTP={2} codigos={3}. Nao repita Criar antes de Diagnosticar.' -f $Metodo,$Caminho.Split('?')[0],$http,$resumo)
    }
  }
  if ($Modo -eq 'Clientes') {
    $lista = Api 'GET' '/customers?limit=100'
    @($lista.data) | ForEach-Object { [pscustomobject]@{ id=$_.id; nome=$_.name } } |
      Format-Table -AutoSize
    Write-Host 'Use somente o ID de um cliente ficticio que voce controla no Sandbox.'
    return
  }
  function EncontrarEnsaios([string]$IdCliente) {
    if ($IdCliente -notmatch '^cus_[A-Za-z0-9]+$') {
      throw 'Informe -ClienteId cus_... de um cliente de TESTES.'
    }
    $desde = (Get-Date).AddDays(-3).ToString('yyyy-MM-dd')
    $offset = 0
    $encontrados = @()
    do {
      if ($offset -ge 2000) {
        throw 'Consulta inconclusiva: mais de 2000 cobrancas recentes. Nao criar outra cobranca.'
      }
      $url = '/payments?customer=' + [uri]::EscapeDataString($IdCliente) +
        '&dateCreated%5Bge%5D=' + $desde + '&limit=100&offset=' + $offset
      $resposta = Api 'GET' $url
      foreach ($item in @($resposta.data)) {
        if ($item.description -eq 'COB-05 ENSAIO SANDBOX NAO PAGAR SEM PEDIDO GUIA' -and
            $item.externalReference -match '^fatura-cob05-lab-[0-9a-f]{12}-2099-01$') {
          $encontrados += [pscustomobject]@{
            id=$item.id; valor=$item.value; status=$item.status;
            referencia=$item.externalReference
          }
        }
      }
      $offset += 100
      $temMais = $resposta.hasMore -eq $true
    } while ($temMais)
    return $encontrados
  }
  if ($Modo -eq 'Diagnosticar') {
    $ensaios = @(EncontrarEnsaios $ClienteId)
    if ($ensaios.Count -eq 0) {
      Write-Host 'SEM_ENSAIO: nao localizei cobranca COB-05 para esse cliente nos ultimos 3 dias.'
      Write-Host 'Consulte tambem o painel do Sandbox antes de criar se houve erro de rede.'
    } else {
      Write-Host ('ENSAIOS_ENCONTRADOS='+$ensaios.Count)
      $ensaios | Format-Table -AutoSize
      Write-Host 'NAO crie outra cobranca. Informe apenas o ID e a referencia.'
    }
    return
  }
  $listaWebhooks = Api 'GET' '/webhooks'
  $compativeis = @($listaWebhooks.data) | Where-Object {
    $_.url -eq $webhook -and $_.enabled -eq $true -and @($_.events) -contains 'PAYMENT_CREATED'
  }
  if ($Modo -eq 'Verificar') {
    if (@($compativeis).Count -gt 0) {
      Write-Host 'PRONTO: webhook do STAGING ativo, com PAYMENT_CREATED habilitado no Sandbox.'
    } else {
      Write-Host 'BLOQUEADO: habilite PAYMENT_CREATED no webhook EXISTENTE do STAGING dentro do Asaas Sandbox.'
      Write-Host 'Caminho: Menu do usuario -> Integracoes -> Webhooks. Nao altere a configuracao de producao.'
    }
    return
  }
  if (@($compativeis).Count -eq 0) {
    throw 'PAYMENT_CREATED nao esta habilitado no webhook do STAGING. Execute -Modo Verificar antes de criar.'
  }
  if ($Modo -eq 'Criar') {
    if ($ClienteId -notmatch '^cus_[A-Za-z0-9]+$') {
      throw 'Informe -ClienteId cus_... de um cliente de TESTES. Execute -Modo Clientes para listar.'
    }
    $anteriores = @(EncontrarEnsaios $ClienteId)
    if ($anteriores.Count -gt 0) {
      $anteriores | Format-Table -AutoSize
      throw 'Cobranca de ensaio ja existente: NENHUMA segunda cobranca foi gerada.'
    }
    $rnd = [guid]::NewGuid().ToString('N').Substring(0,12).ToLowerInvariant()
    # O formato fatura-<loja>-2099-01 dispara a retentativa segura de fatura sem vinculo local.
    $ref = 'fatura-cob05-lab-'+$rnd+'-2099-01'
    $body = @{
      customer=$ClienteId; billingType='PIX'; value=5.00;
      dueDate=(Get-Date).AddDays(10).ToString('yyyy-MM-dd');
      externalReference=$ref;
      description='COB-05 ENSAIO SANDBOX NAO PAGAR SEM PEDIDO GUIA'
    }
    $nova = Api 'POST' '/payments' $body
    if ($nova.id -notmatch '^pay_[A-Za-z0-9]+$' -or $nova.externalReference -ne $ref) {
      throw 'Resposta divergente. Consulte manualmente a cobranca antes de qualquer nova operacao.'
    }
    Write-Host ('COBRANCA_COB05_ID='+$nova.id)
    Write-Host ('REFERENCIA_TEMPORARIA='+$ref)
    Write-Host ('STATUS='+$nova.status)
    Write-Host 'NAO confirme/pague esta cobranca e NAO execute Liberar antes da auditoria da fila.'
    return
  }
  if ($Modo -eq 'Liberar') {
    if ($CobrancaId -notmatch '^pay_[A-Za-z0-9]+$') {
      throw 'Informe -CobrancaId pay_... do ensaio.'
    }
    $atual = Api 'GET' ('/payments/'+$CobrancaId)
    if ($atual.id -ne $CobrancaId -or
        $atual.description -ne 'COB-05 ENSAIO SANDBOX NAO PAGAR SEM PEDIDO GUIA' -or
        $atual.externalReference -notmatch '^fatura-cob05-lab-[0-9a-f]{12}-2099-01$' -or
        $atual.billingType -ne 'PIX' -or
        [decimal]$atual.value -ne [decimal]5 -or
        @('PENDING','OVERDUE') -notcontains $atual.status) {
      throw 'Cobranca nao corresponde ao ensaio pendente: nenhuma atualizacao realizada.'
    }
    $refNeutra='cob05-lab-liberado-'+([guid]::NewGuid().ToString('N').Substring(0,12))
    $saida=Api 'PUT' ('/payments/'+$CobrancaId) @{externalReference=$refNeutra}
    if ($saida.id -ne $CobrancaId -or $saida.externalReference -ne $refNeutra) {
      throw 'Atualizacao nao confirmada. Consulte a cobranca no Sandbox antes de repetir.'
    }
    Write-Host ('COBRANCA_COB05_ID='+$CobrancaId)
    Write-Host ('REFERENCIA_CORRIGIDA='+$refNeutra)
    Write-Host 'Aguarde o Cron do STAGING concluir o mesmo webhook apos o backoff; NAO pague.'
    return
  }
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Variable -Name chave,seguro -ErrorAction SilentlyContinue
}
