# Integração Asaas — faturamento mensal e carteira do motoboy (2026-10-08)

## Objetivo

- O comércio continua devendo **7%** nas vendas presenciais com entrega: **5%** para a plataforma e **2%** para o motoboy da entrega comprovada.
- O comércio paga a **fatura mensal por Pix Asaas**. O dinheiro entra na **conta Asaas da plataforma**, não em uma conta própria do motoboy.
- Após confirmação bancária de recebimento no Asaas, os créditos elegíveis são liberados; o motoboy saca por Pix no **Guia Andrelândia**, usando chave Pix, sem conta/app Asaas.
- Os demais pedidos (incluindo checkout Mercado Pago) continuam com os fluxos atuais. O módulo Asaas **não** permite saque de créditos de pedidos pagos no Mercado Pago, pois os recursos ainda não foram recebidos na conta Asaas. Isso exige projeto de conciliação/tesouraria separado; nunca usar saldo Asaas em favor de fundos não cobertos.

## Estado da implementação e limites

**Alterações somente na branch de revisão; não aplicar em produção antes da homologação.**
- `supabase/pending-migrations/20261008180000_asaas_faturas_saques_controlados.sql` cria tabelas e RPCs isoladas com RLS, travas de concorrência e reservas por remuneração, sem apagar nada.
- `supabase/functions/catalogo-asaas-financeiro/index.ts`: cobrança, consulta, carteira, Pix de saída, webhook.
- `pages/catalogo-admin.html`, `js/catalogo-admin.js`: cobrança mensal Asaas com cadastro do pagador.
- `pages/motoboy.html`, `js/motoboy.js`: saldo sacável **efetivamente financiado pelo Asaas**, saque e histórico.
- `pages/entregas-operacao.html`, `js/entregas-operacao.js`: lista de saques e emissões pendentes, visível apenas ao administrador da plataforma, sem botão de pagamento.
- `catalogo-fatura-pix` do Mercado Pago fica disponível para **faturas antigas**, mas não gera faturas novas pelo painel atualizado.
- A confirmação de pedido, entregas, avaliações, mapas, fotos, marketplace online e demais funcionalidades **não foram alteradas**.
- Sem saldo e sem credenciais, a UI mostra saque desabilitado.
- Se o POST de transferência tiver resposta ambígua, o saque fica em **revisão, sem repetição automática**. Checar extrato de transferências no Asaas antes de qualquer decisão administrativa.

## Instalação controlada

1. Obter aprovação para a funcionalidade de API de transferências da conta Asaas e conferir limites, tarifas, eventual validação por SMS/Token APP, titularidade das chaves Pix e responsabilidade pelas taxas.
2. Criar contas de **sandbox e produção separadas**, obter as respectivas API keys. Nunca registrar chaves no GitHub, JS público ou logs.
3. Após homologação e backup, mover a migration de **pending-migrations** para a pasta **migrations** com a versão oficial e atualizar o inventário aplicado (o projeto atual exige exatamente 29 migrações confirmadas). Aplicar somente no momento da implantação controlada. Conferir as constraints, RLS e funções.
4. Configurar Supabase Edge Function `catalogo-asaas-financeiro` com `verify_jwt=false` **apenas para permitir webhook Asaas**, pois as demais rotas verificam o JWT em `auth.getUser()` e a rota webhook verifica um token próprio.
5. Adicionar os **Secrets** da Edge Function (Supabase → Edge Functions → Secrets):
   - `ASAAS_API_KEY` = chave sandbox inicialmente
   - `ASAAS_ENVIRONMENT` = `sandbox` ou `production`; sem valor usa **sandbox**
   - `ASAAS_WEBHOOK_TOKEN` = token seguro diferente da chave API, 32–255 caracteres
   - `ASAAS_BILLING_ENABLED` = `false` inicialmente
   - `ASAAS_PAYOUTS_ENABLED` = `false` inicialmente
   - `CATALOGO_DATA_ENCRYPTION_KEY` = **mesma chave já usada** nos perfis dos motoboys; não trocar sem plano de recifragem.
6. Configurar webhook do Asaas no painel:
   `https://xdmbkflufsfqziixzpxc.supabase.co/functions/v1/catalogo-asaas-financeiro/webhook`
   Selecionar eventos de cobrança (recebimento, estorno e demais alterações) e transferência (concluída, falha, cancelamento), autenticar com o mesmo `ASAAS_WEBHOOK_TOKEN`. Confirme a versão dos eventos conforme a documentação vigente.
7. Testar em sandbox cadastro de pagador, emissão, reconsulta, recebimento, webhook duplicado, estorno, Pix concluído, Pix falho, duas solicitações simultâneas e timeout após requisição, garantindo **zero duplicações**.
8. Somente depois habilitar `ASAAS_BILLING_ENABLED=true` no ambiente de teste; liberar `ASAAS_PAYOUTS_ENABLED=true` depois dos testes de saque. Para produção, repetir homologação com cobrança pequena e conta real, aprovar e ativar flags uma por vez.

## Segurança e consistência

- A fatura original é rastreada por `catalogo_fatura_cobrancas`, com `gateway='asaas'`; cobrança vinculada a MP não é reemitida por Asaas.
- A compensação de um Pix de mensalidade só é marcada após validação por GET autenticado no Asaas, exigindo mesmo ID, cliente, `externalReference`, método Pix e total.
- Crédito sacável: remuneração `disponivel`, entrega confirmada, fatura mensal **paga no Asaas**, sem revisão financeira e sem reserva de saque ativa.
- Criação de saque é transacional no banco; cada crédito pode estar em **uma única reserva ativa**. Um trigger impede que o repasse manual antigo consuma esse crédito enquanto estiver reservado. A baixa final exige atualização de todos os créditos, caso contrário a transação é abortada.
- A chave Pix fica cifrada no Supabase, nunca é retornada em extrato sem autenticação.
- `POST /transfers` usa `externalReference=saque_id`; mesmo timeout não cria segunda transferência automaticamente. O administrador poderá informar **somente os identificadores da transferência existente** na área de auditoria de entregas e solicitar um `GET /transfers/{id}`. O servidor valida ID, referência, valor e status antes de reconciliar; esse procedimento **nunca** executa outro POST de transferência.
- Na emissão da fatura, uma reserva exclusiva bloqueia emissões concorrentes. Caso exista uma reserva sem cobrança interna (timeout), uma nova solicitação consulta o Asaas pela referência externa e só recupera uma cobrança única verificada; **não** envia outro POST. Se não encontrar, mantém a revisão administrativa.
- O antigo registro de repasse manual é protegido por trigger: não pode baixar um crédito com reserva Asaas ativa.
- Saque só é marcado como `concluido` depois de `GET /transfers/{id}` com `status=DONE` e verificação de valor, ID e referência.
- Banco e logs não são carteira de moeda eletrônica; são registro contábil do saldo da plataforma devido ao motoboy.
- Se faltarem fundos após tarifas ou retenções da conta, o payout pode falhar; definir responsável por tarifas e conta de origem.

## Auditoria de limpeza: o que NÃO remover agora

O projeto possui **38 tabelas públicas** no Supabase (levantamento de 2026-10-08). Contêm dados históricos e dependências:
- **Preservar:** `catalogo_pedidos`, `catalogo_pedido_itens`, `catalogo_entregas_atribuidas`, `catalogo_remuneracoes_v2`, `catalogo_lancamentos_financeiros_v2`, `catalogo_repasses_v2`, `catalogo_fatura_cobrancas`, `catalogo_fatura_componentes_v2`, `catalogo_comissoes_offline`, `catalogo_fechamentos_offline`, `catalogo_logistica_offline_v2`, tabelas de eventos e RLS. Sem esses dados não há reconciliação confiável.
- **Preservar legado Mercado Pago:** OAuth, recebedores, checkout, Webhook, tabelas de pagamento; o marketplace online ainda usa esse provedor. Não apagar mesmo que pareçam redundantes.
- **Avaliar em etapa posterior:** `catalogo_assinaturas`/`catalogo_pagamentos` sem linhas, páginas sandbox de testes e `catalogo_marketplace_testes`; só após pesquisa completa de referências e provas de inexistência de consumidores, inclusive automações e funções de produção.
- **NÃO apagar:** `storage_cleanup_queue` (fila de limpeza de imagens com 96 entradas na inspeção), conteúdo de notícias, avaliações, comentários ou cadastros. A fila não é lixo só por conter muitos itens.

Política de limpeza: marcação de dependências primeiro, backup, consulta a histórico e cron, testes, desativação reversível e remoção numa migration específica **separada**. Esta PR não contém DROP, TRUNCATE nem DELETE de dados existentes.

## Limitação financeira a resolver antes da produção completa

As comissões de compras pagas com checkout Mercado Pago não entram automaticamente no saldo Asaas. O saldo sacável Asaas cobre somente as comissões provenientes de faturas **efetivamente pagas no Asaas**. Se a intenção é saque unificado para Pix, cartão e dinheiro, será necessária uma solução de **tesouraria/fluxo de fundos**, após avaliar custos, prazos, obrigações e conciliação entre plataformas. Não permitir saque de créditos sem recursos depositados em Asaas.

## Referências

- https://docs.asaas.com/reference/criar-nova-cobranca
- https://docs.asaas.com/reference/transferir-para-conta-de-outra-instituicao-ou-chave-pix
- https://docs.asaas.com/docs/criar-novo-webhook-pela-aplicacao-web
- https://docs.asaas.com/docs/transferencias

## Itens necessários antes de declarar a integração pronta

- [ ] Aprovação da conta Asaas, cadastro de chave Pix da plataforma, saldo/limites/tarifas de transferências e habilitação do API Key.
- [ ] API sandbox: teste E2E com cobranças, faturas, duplicação de webhook, estorno, bloqueio `CONFIRMED`, status `RECEIVED`, transferência `DONE`, `FAILED`, `CANCELLED`, timeout, recuperação por ID e concorrência real.
- [ ] Amarrar política financeira das taxas de transferências, prazo de saque e possíveis mínimos/limites.
- [ ] Revisar se a conta suporta as transferências de saída via API sem intervenção humana; se houver Token APP/SMS ou validação de saque por webhook, adequar o fluxo.
- [ ] Garantir reserva de saldo para comissões de pedidos recebidos pelo Mercado Pago, se a carteira for futuramente unificada.
- [ ] Definir retenção de PII (CPF/CNPJ do comércio e chave Pix), texto LGPD e direitos do titular.
- [ ] Homologar rollback, conciliação e alertas operacionais; migrar SQL pendente ao histórico de produção e implantar Edge com flags desligadas.
- [ ] Ativar operações separadamente após validação real de webhooks e status; não tratar CI verde como certificação financeira.
