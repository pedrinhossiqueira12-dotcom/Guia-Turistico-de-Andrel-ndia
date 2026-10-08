# Saques mensais do entregador — implementação e habilitação

**Estado 08/10/2026:** código em PR #37; **não publicado** em `main` nem no Supabase. Sem transferências reais. Requer habilitação/homologação contratual da API Payouts do Mercado Pago.

## Regras de negócio

- O motoboy recebe **2% do subtotal dos produtos** de cada entrega concluída, arredondado em centavos; a plataforma recebe os **5% restantes, aproximadamente**, de modo que a taxa **total é 7% arredondada uma única vez**. Entrega/frete não entra na base de comissão.
- Mesmo em pedidos pagos em Pix, o crédito logístico de 2% existe. Ele é disponibilizado **somente com lastro efetivamente comprovado** na plataforma. Para pedidos em dinheiro/cartão presencial, depende da baixa integral e da comprovação de recebimento da parcela logística e comissão offline; aceitar um pedido não cria saldo financiado.
- Os créditos de entregas concluídas ficam visíveis no extrato. Para solicitar um saque, devem estar `disponivel`, `financiamento_comprovado=true`, com parcela efetivamente financiada e `disponibilizado_em` **anterior ao início do mês corrente em America/Sao_Paulo**. Créditos novos ficam para o próximo fechamento. Mínimo R$ 1,00, pois a API de Payouts define mínimo de BRL 1.
- O motoboy cadastra **sua própria chave Pix**, protegida por AES-GCM com AAD do UUID da conta. O request usa cópia cifrada da chave no momento da solicitação; o navegador jamais decide beneficiário ou valor.
- O saldo disponível para saque considera somente créditos elegíveis ainda não reservados. O bloqueio por usuário e pedidos, unicidade de reservas ativas e trigger de atualização impedem dois saques, ou saque e repasse manual, para o mesmo crédito.
- O saque passa por `solicitado`, `processando`, `aguardando_confirmacao`, e apenas por **`pago` após GET autenticado ao provedor retornar `success/accredited` com transação, valor em BRL e referência idênticos**. Estados `approved`, `created`, `in_progress`, `error`, HTTP 202 e timeout **não** representam pagamento.
- Se houver chargeback/reversão ou divergência entre saldo registrado e prova bancária, vai para `revisao`. O dinheiro transferido não é apagado do histórico. Rejeição inequivocamente terminal `rejected` pode liberar crédito para nova solicitação.

## Passos de implantação — somente após sucesso dos testes isolados

1. Revisar **29 migrações já aplicadas** e única nova `20261008160000_saques_motoboy_mensais_v2.sql`; verificar histórico remoto antes de aplicar. Fazer cópia restaurável do Supabase, se possível. O backup GitHub **não** copia dados, Storage ou Auth.
2. Aplicar a nova migration como operação própria. Não reaplicar o histórico financeiro de 5%/7%, nem usar `supabase db push` bruto quando versões locais estão em aliases diferentes dos remotos.
3. Atualizar o bundle `catalogo-entregas` incluindo `_shared/catalogo-entregas-crypto-v2.ts`, preservando a configuração atual de JWT/custom authentication. Implantar `catalogo-saque-payout` com ambos os módulos de `_shared/`, mantendo endpoint **privado e com segredo exclusivo**, nunca publicando segredos no frontend. **Não ativar payouts** nessa etapa.
4. Publicar HTML/JS do painel somente após banco e Edge atualizados. Conferir que o motoboy consegue solicitar usando conta autorizada e que o saldo reservado não pode ser repassado de novo no admin. Em produção sem Payouts habilitado, o painel informa que a transferência está pendente, sem mentir que foi enviada.

## Configuração do Mercado Pago Payouts

A documentação oficial é:
- https://www.mercadopago.com.br/developers/pt/docs/payouts/overview
- https://www.mercadopago.com.br/developers/pt/docs/payouts/integration-configuration/money-transfers
- https://www.mercadopago.com.br/developers/pt/docs/payouts/go-to-production

**Atenção:** o checkout split 1:1 do Mercado Pago não substitui a API de transferências `POST /v1/payouts`. A autorização do checkout não prova que a conta tem Payouts habilitado. Solicitar acesso à solução/credenciais Payouts na conta da plataforma, saldo disponível e habilitação de chave Ed25519 com a equipe de integrações.

Segredos de backend Supabase (nunca salvar no GitHub):
- `CATALOGO_SAQUE_WORKER_SECRET`: segredo aleatório longo (o worker requer esse segredo em `x-worker-secret`).
- `MP_PAYOUTS_ACCESS_TOKEN`: credencial **Payouts da conta que possui os recursos financeiros**, distinta de qualquer token do frontend.
- `MP_PAYOUTS_MODE=test` e `MP_PAYOUTS_ENABLED=true` **somente depois de homologar o ambiente de teste**.
- `CATALOGO_SAQUE_AUTOMATICO=true` no serviço `catalogo-entregas` apenas depois de testar o endpoint worker. Sem essa flag, nenhum clique no motoboy provoca transferência.
- `MP_PAYOUTS_ED25519_PKCS8_B64`: chave Ed25519 privada em PKCS8 DER/base64 **somente no backend**; a pública correspondente deve ser cadastrada com a equipe do Mercado Pago.
- Em ambiente produtivo, `MP_PAYOUTS_MODE=production` e `MP_PAYOUTS_LIVE_ENABLED=true` devem ser ativados somente após testes/credenciamento e aprovação final. Faltando qualquer uma dessas flags, não há transferência em produção.

No teste, as requisições Payouts usam `X-test-token:true` e `X-enforce-signature:false`. Na produção usam `X-enforce-signature:true`, `X-signature` Ed25519 e `X-Idempotency-Key` persistida. A resposta HTTP 202 apenas indica aceitação; **nunca** marca o crédito como pago.

### Conciliação periódica e falhas

A função privada pode ser chamada com `{"acao":"varrer"}` por um agendador autenticado com o mesmo segredo exclusivo: ela obtém **um** saque da fila do banco por chamada, prioriza solicitações novas e reconsulta as pendentes. Executar esta varredura **depois** de habilitar Payouts, usando Cron/pg_net e Vault com secrets protegidos. Sem agendamento, a primeira solicitação aciona o worker imediatamente quando `CATALOGO_SAQUE_AUTOMATICO` está ativo; saques que permanecem pendentes exigem reconsulta manual ou o agendador.

Não inventar horário de payout: processamento bancário é assíncrono. Monitorar idempotência, transações `revisao` e notificações oficiais, sem reexecutar novo payout com chave idempotente diferente. **Não habilitar automaticamente o Cron em uma migration de produção sem secrets e contrato Payouts válidos.**

## Cenários de homologação obrigatórios

- [ ] Sessão falsa/expirada; motoboy não autorizado; tentativa de enviar valor e UUID de outra conta.
- [ ] Duas solicitações simultâneas; tentativa de pagar o mesmo crédito no painel administrativo.
- [ ] Pedido Pix pago e entrega comprovada; dinheiro/cartão não financiado; crédito de mês ainda aberto; mínimo inferior a R$1.
- [ ] Mudança de chave Pix após solicitação; estorno/chargeback entre aceite e transferência.
- [ ] MP responde HTTP 202, `approved`, `pending`, `success/in_progress`, `success/accredited`, `rejected`, `error`.
- [ ] Timeout entre HTTP POST e gravação do ID; repetição usa **mesma** referência/Idempotency-Key e nunca cria dois Pix.
- [ ] Queda do worker antes da baixa final; reconsulta autenticada do status; conflito no ledger dispara revisão.
- [ ] Segredos não aparecem no navegador nem nos logs; nenhum endpoint de saque aceita transação como paga a partir de status enviado pelo usuário.
