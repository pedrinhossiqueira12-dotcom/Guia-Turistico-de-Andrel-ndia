# Etapa 2 — Mercado Pago Payouts (somente sandbox; sem dinheiro real)

**Status em 08/10/2026:** adaptador de integração criado e testado sem rede. **Não ativado no site, sem novas Edge Functions públicas e sem credenciais salvas.** PR #38 em rascunho.

## O que foi desenvolvido

- Adaptador servidor em supabase/functions/_shared/catalogo-payouts-sandbox-v2.ts.
- Constrói POST https://api.mercadopago.com/v1/payouts com uma transação Pix, valor convertido de **centavos inteiros**, chave Pix com tipo explícito e referência determinística originada do UUID da solicitação.
- Envia **somente em modo de teste**, exigindo testApproved=true, transporte HTTP injetado, credencial exclusiva de teste e headers X-test-token:true, X-enforce-signature:false e X-Idempotency-Key estável.
- Rejeita valores abaixo do mínimo do provedor (R$ 1), identificadores inválidos e destinatários sem chave/tipo Pix compatível.
- A criação com HTTP **202** fica em processamento; nunca registra como pago.
- Consulta GET /v1/payouts/{payout_id}/transactions/{transaction_id} e só **classifica** como confirmado quando status=success, status_detail=accredited, ID, referência, BRL e valor batem.
- Testes Deno em CI usam **fake transport e bloqueio de rede**, garantindo que não existe cobrança/transferência durante o teste.
- O módulo não está importado em nenhuma Edge Function publicada e não oferece caminho de ativação automática.

## Pré-requisitos externos (NÃO forneça tokens no chat nem no GitHub)

1. No Mercado Pago Developers > **Suas integrações**, verificar a disponibilidade/habilitação de **Payouts** para a conta que enviará os valores. O acesso ao checkout de pagamentos **não garante** habilitação de Payouts.
2. Ter aplicação/credenciais de TESTE de Payouts autorizadas. A eventual credencial MP_PAYOUTS_TEST_ACCESS_TOKEN deverá ser cadastrada **somente como segredo de backend**, sem commit e sem inclusão em HTML/JS público. O nome é proposto para a etapa 3; **ainda não existe Edge consumidora**.
3. Validar uma conta destinatária de teste e a chave Pix correspondente em ambiente de teste. O adaptador recebe pixType explícito: EMAIL, PHONE, CPF, CNPJ ou PIX_CODE; **não infere tipo por texto ambíguo**. O formulário atual armazena apenas a chave, portanto na etapa 3 deverá ganhar seleção/verificação do tipo pelo backend, sem enviar Pix por dados não verificados.
4. O valor vem exclusivamente de créditos financiados do banco, não do navegador. É necessário reservar o lote transacionalmente antes de qualquer POST e armazenar **uma mesma chave de idempotência** para retries.
5. Para produção é obrigatória **assinatura Ed25519** no corpo em X-signature e processo de cadastramento de chave pública junto ao Mercado Pago. **Isso não está implementado**, deliberadamente. Não use o adaptador sandbox para produção.

## O que falta para o saque automático (etapas 3–5)

- Registrar intent / estado reservado, enviando, aguardando_confirmacao, pago, falhou, em_analise, com locks, idempotência por lote e correlação por IDs do provedor.
- Autorizar somente backend/admin/cron com segredo e autenticação independente; não criar endpoint público de pagamentos acionável via navegador.
- Atualizar perfil do motoboy para salvar **tipo de chave** e proteger alterações quando houver uma transferência pendente.
- Processar webhook como **sinal**, mas confirmar status fazendo GET autenticado do provedor. Eventos podem chegar atrasados, repetidos ou fora de ordem. Confirmação deve comparar beneficiário, valores, moeda, IDs e referências.
- Permitir reprocessamento seguro de timeout sem criar outro payout; travar saque contra chargeback/estorno e bloqueio de lastro.
- Produção requer política de limites, monitoramento, reconciliação e homologação real de teste antes de ligar transferências.
- O status pago não pode decorrer de resposta HTTP 202, nem de solicitação criada.

## Documentação oficial consultada

- https://www.mercadopago.com.br/developers/pt/docs/payouts/overview
- https://www.mercadopago.com.br/developers/pt/docs/payouts/integration-configuration/money-transfers
- https://www.mercadopago.com.br/developers/pt/docs/payouts/integration-test
- https://www.mercadopago.com.br/developers/pt/docs/payouts/notifications
- https://www.mercadopago.com.br/developers/pt/docs/payouts/go-to-production
