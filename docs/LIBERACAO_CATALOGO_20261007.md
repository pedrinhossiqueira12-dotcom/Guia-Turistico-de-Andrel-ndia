# Marketplace liberado — 07/10/2026

## Estado confirmado em produção

A liberação geral foi ativada no projeto Supabase `xdmbkflufsfqziixzpxc` em 07/10/2026, às 02h31 de Brasília, conforme autorização do proprietário. Não está mais restrita ao comércio de teste.

| Controle | Estado |
|---|---|
| Modelo antifraude V2 | Ativo |
| Restrição a comércios piloto | Removida (`comercios_piloto=NULL`) |
| Pix, dinheiro e cartão presencial | Mantidos (`somente_pix=false`) |
| Entrega | 7%: 5% plataforma + 2% reservados ao motoboy |
| Retirada/consumo local | 5%, sem remuneração de entregador |
| Fechamento mensal de comissões presenciais | Ativo |
| Emissão Pix da fatura no painel | Ativa |
| Monitor de confiabilidade | Ativo, a cada 15 minutos |
| Transferência bancária automática ao motoboy | Não implementada; repasse é operacional/manual |

A liberação global **não dispensa** a conexão Mercado Pago de cada estabelecimento, a validação de propriedade, o comércio ativo nem os controles de bloqueio. Não existe mensalidade para ativar o catálogo.

## Pagamentos e webhook

- O novo Pix real de R$ 1,00 foi aprovado e conciliado, com R$ 0,07 de taxa registrada: R$ 0,05 da plataforma e R$ 0,02 de reserva logística. Aprovação não significa que o pedido foi entregue nem que o motoboy já recebeu transferência.
- As notificações assinadas anteriormente recusadas com 401 foram corrigidas por sincronização da assinatura produtiva existente. A simulação oficial posterior passou; não se desativou a verificação criptográfica.
- A função `mercadopago-marketplace-webhook`, versão 35, encaminha notificações de Orders vinculadas a faturas locais à função de fatura. Destino fixo no próprio projeto; assinatura original preservada; erros do destino não são ocultados.
- `catalogo-fatura-pix`, versão 8, está ativa. A validação administrativa fez somente `GET /users/me`, confirmou a conta recebedora e retornou `success=true`, `pronto=true`, `vendedor_validado=true` e todas as flags de faturamento ativas.
- A validação aceita administrador autenticado ou a chave interna exata, por comparação de digest. A chave pública não autoriza essa consulta. O suporte ao cabeçalho `apikey` do painel **não libera a emissão financeira** por esse caminho.
- Secrets da plataforma e da fatura foram configurados no backend. Nenhum valor de credencial está neste documento ou no pacote do código.

### Funcionamento da cobrança mensal

O cron `andrelandia-fechamento-offline-diario` está ativo às 03h15 UTC (00h15 de Brasília). Processa a competência do **mês anterior**, de modo idempotente, e verifica inadimplência. Não é uma assinatura nem um débito automático na conta bancária.

A emissão do Pix da fatura é feita pela ação correspondente no painel do comércio. O monitor `catalogo-entregas-v2-monitor` está ativo a cada 15 minutos; não confirma entregas nem transfere dinheiro.

## Entregador e código

Os 2% também se aplicam a entregas pagas por **Pix**. O código do comprador fica disponível após aprovação, é informado ao entregador na entrega e precisa ser confirmado pelo operador autorizado. A entrega física e o recebimento financeiro são estados separados.

No pagamento presencial, a obrigação do comércio é registrada no aceite, sem depender de o motoboy informar o código. Um cancelamento posterior não apaga automaticamente a obrigação e exige a revisão prevista no fluxo. A remuneração do motoboy só fica financeiramente disponível quando existir lastro comprovado; um saldo registrado não é transferência realizada.

**Limite importante:** dinheiro/cartão presencial ainda envolve risco de inadimplência e conluio. Auditoria, cobrança e bloqueio reduzem esse risco, mas não garantem recebimento de dinheiro que não passou pela plataforma.

## Ajustes visuais publicados

- Banner personalizável do `store-hero` pela área **Editar meu comércio** da página `local`.
- Persistência no Supabase, validação do arquivo, isolamento do proprietário e fallback legível verde/creme.
- Telefone, ligação e WhatsApp do comprador no `catalogo-admin` **após o aceite**, preservando a barreira contra desvio de contato antes do registro da comissão.
- Card distingue motoboy selecionado, oferta aguardando aceite, atribuição efetiva, coleta e saída para entrega.
- Página própria de motoboy permanece separada de produtos e faturas.
- Comprador mantém o código sem botão de remoção acidental; o botão de código desaparece após conclusão.

A migração de banner `20261007040955` está aplicada e `catalogo-admin` versão 47 está ativo. A vitrine continua com `security_invoker=true`; não foi aberta permissão pública de atualização.

## Validação realizada

- **350 testes passaram; 0 falhas e 0 testes ignorados.** Incluem testes SQL locais, mocks executáveis de endpoints, autorização, isolamento, idempotência, concorrência já documentada e interface. Não equivalem a 350 pagamentos reais.
- `npm run check:edge` concluído com sucesso.
- `git diff --check` sem erros.
- Funções de fatura e webhook testadas e implantadas primeiro em staging; hashes correspondentes aos de produção.
- Pix real e taxa comprovados; validação real de credenciais da fatura realizada sem criar cobrança.
- Não foram feitos repasses, estornos ou novos pagamentos nesta conclusão.

## Rotina necessária após a liberação

1. Vincular somente entregadores autorizados e acompanhar ocorrências/cancelamentos no painel de operação.
2. Efetuar e registrar os repasses reais dos saldos disponíveis dos motoboys; o site não faz isso automaticamente.
3. Acompanhar o primeiro fechamento mensal real e sua primeira fatura paga. Credenciais e integração foram validadas, mas **não foi paga uma fatura mensal real nesta execução**.
4. Conferir o Pix antigo de R$ 7,00 informado como pago e depois cancelado no site. Cancelar o pedido no site não garante estorno no Mercado Pago; nenhum estorno foi feito aqui.
5. Manter backups, atualizar dependências, revisar alertas Supabase e proteger as contas administrativas. Nenhum site pode ser declarado invulnerável ou com capacidade ilimitada.

## Código e sincronização

O frontend solicitado já foi publicado na main e no Cloudflare Pages. Os últimos ajustes de backend já estão ativos no Supabase, independentemente de um novo deploy do site.

A escrita GitHub desta integração foi bloqueada em tentativas anteriores apesar do papel administrativo informado. O pacote final inclui o **código completo**, uma atualização seletiva com hashes e o instalador com backup para sincronizar os arquivos locais e publicar usando a credencial Git do proprietário. Não reaplique migrações, não redeploye funções antigas e não use force-push.
