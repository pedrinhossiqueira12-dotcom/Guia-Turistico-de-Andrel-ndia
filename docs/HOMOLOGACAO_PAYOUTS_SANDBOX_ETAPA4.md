# Etapa 4 — Homologação Payouts Sandbox

Data: 08/10/2026. **Estado: preflight offline disponível; ainda não realizado teste autenticado de rede com a conta Mercado Pago. PR #38 DRAFT, sem deploy nem transferências reais.**

## Documentação oficial

- [Testes Mercado Pago Payouts](https://www.mercadopago.com.br/developers/pt/docs/payouts/integration-test)
- [Transferências Payouts](https://www.mercadopago.com.br/developers/pt/docs/payouts/integration-configuration/money-transfers)
- [Status e erros](https://www.mercadopago.com.br/developers/pt/docs/payouts/resources/transaction-status-and-errors)
- [Credenciais](https://www.mercadopago.com.br/developers/pt/docs/payouts/resources/credentials)
- [Preparar produção](https://www.mercadopago.com.br/developers/pt/docs/payouts/go-to-production)

Mercado Pago Payouts usa POST /v1/payouts, X-test-token: true e Access Token de TESTE. HTTP 202 é apenas aceito para processamento. O resultado final vem do GET /v1/payouts/{payout_id}/transactions/{transaction_id}; apenas success/accredited é crédito confirmado. Status success/in_progress, transaction_in_process/pending_bank e pending_authorized não autorizam baixa. Reembolsos e rejeições exigem revisão.

O valor mínimo oficial por transferência é R$ 1,00. Ganhos inferiores devem acumular no saldo e não desaparecer. A RPC de solicitação mensal agora recusa um lote abaixo de R$ 1,00 sem marcar seus créditos como solicitados, permitindo incluí-los no próximo fechamento. Produção exige assinatura Ed25519 e chave pública cadastrada com o Mercado Pago.

## Pré-requisitos externos

1. Acesse Mercado Pago Developers > Suas integrações e verifique se a aplicação vinculada ao Guia está habilitada para o produto **Payouts**; checkout Pix comum não confere essa habilitação.
2. Na aplicação Payouts, acesse Dados da integração > Testes > Credenciais de teste e ative o Access Token de TESTE, se necessário.
3. Providencie uma chave Pix cadastrada e controlada para teste. Não usar a conta real de um motoboy.
4. Instale Deno 2.x e abra o repositório na branch do PR #38. Não aplique migrations ao banco de produção.
5. Não compartilhe tokens ou chaves Pix em GitHub, commits, chat, URLs públicas ou logs. Nunca use credencial produtiva para homologação, mesmo com X-test-token: true.

## Teste offline sem rede ou segredos

Na raiz do repositório, execute:

    deno run scripts/validacao-pagamentos/payouts-sandbox-preflight.ts --dry-run

Resultado esperado: PASS_SIMULACAO: sem rede, sem segredo, sem dinheiro e sem alterações no Supabase.

Este teste simula POST 202 e GET success/accredited, mas NÃO comprova acesso real ao Mercado Pago.

## Nova checagem de prontidão — SEM REDE

Execute na raiz do projeto, mesmo sem nenhuma credencial:

    deno run scripts/validacao-pagamentos/payouts-sandbox-preflight.ts --readiness

O resultado não exibe token, chave Pix nem UUID. Ele somente indica se faltam:
- Access Token de TESTE e sua origem comprovada;
- dupla confirmação explícita;
- UUID do ensaio;
- destinatário com chave de formato compatível;
- igualdade indevida entre token de teste e possíveis tokens de produção no ambiente.

Sem permissões ou variáveis configuradas, o resultado será "aptoParaPrepararTesteSandbox": false e "transferenciaExecutada": false. Isso é o resultado esperado: o script **não consulta a conta Mercado Pago nem transfere valores**.

Com variáveis de teste configuradas, execute somente:

    deno run --allow-env scripts/validacao-pagamentos/payouts-sandbox-preflight.ts --readiness

Mesmo que a checagem local indique estar preparado, **o acesso Payouts ao Mercado Pago e a procedência do token precisam ser conferidos pelo proprietário no painel oficial**. Chave Pix com sintaxe correta não comprova titularidade.

**Trava adicional:** se MP_PAYOUTS_TEST_ACCESS_TOKEN for idêntico a MP_PLATFORM_ACCESS_TOKEN, MP_ACCESS_TOKEN, MERCADO_PAGO_ACCESS_TOKEN ou MP_PAYOUTS_PROD_ACCESS_TOKEN presente no ambiente, o envio em modo Sandbox será bloqueado. O script nunca mostra os tokens.

## Teste HTTP APENAS em Sandbox, após consentimento explícito

As variáveis de ambiente abaixo devem ser configuradas **localmente**, sem registrar segredo no código:

| Variável de ambiente | Valor esperado |
| --- | --- |
| MP_PAYOUTS_TEST_ACCESS_TOKEN | Access Token de TESTE do Payouts |
| MP_PAYOUTS_TEST_PIX_TYPE | CPF, CNPJ, EMAIL, PHONE ou PIX_CODE |
| MP_PAYOUTS_TEST_PIX_KEY | Chave Pix de destino de TESTE |
| MP_PAYOUTS_TEST_RUN_ID | Um novo UUID fixo por ensaio |
| MP_PAYOUTS_TEST_APPROVED | CONFIRMO_SANDBOX |
| MP_PAYOUTS_TEST_DESTINATION_APPROVED | DESTINO_TESTE_CONFIRMADO |

O script usa valor fixo **R$ 1,00**, sempre testa com X-test-token: true e não tem acesso ao Supabase ou à chave de produção.

Com as variáveis locais, executar explicitamente:

    deno run --allow-env --allow-net=api.mercadopago.com --allow-read=.payouts-sandbox-state --allow-write=.payouts-sandbox-state scripts/validacao-pagamentos/payouts-sandbox-preflight.ts --execute-sandbox

O identificador da tentativa é salvo em .payouts-sandbox-state ANTES do POST; o diretório está no .gitignore e não guarda token nem chave Pix. Se houver timeout ou resposta incerta, NÃO reenviar: investigar a referência no provedor.

## Consultar status sem novo envio

Com as mesmas variáveis e o mesmo UUID:

    deno run --allow-env --allow-net=api.mercadopago.com --allow-read=.payouts-sandbox-state scripts/validacao-pagamentos/payouts-sandbox-preflight.ts --check-status

O comando usa exclusivamente GET com POP/TOP previamente registrados. Não cria novo payout, não altera banco Supabase nem publica comprovante. Se não houver POP/TOP por falha do primeiro POST, o resultado é indeterminado e exige investigação manual.

## Critérios de aprovação

- Token sem acesso ou 401/403: **bloqueado**, confirmar habilitação do produto.
- POST 202: **aguardando processamento**, sem repasse.
- GET pending, pending_bank, success/in_progress: **aguardar**, sem repasse.
- GET success/accredited e IDs, moeda, valor e referência conferidos: **sucesso de teste**, sem registrar repasse real.
- GET error/rejected/refunded: **revisão humana**, não repetir POST.
- Falha de rede após POST: **estado indeterminado**, nunca executar outro POST automaticamente.
- Mesmo UUID local repetido: execução bloqueada.

## Pendências para produção

- Acesso à conta Mercado Pago Payouts e credenciais de teste ainda não verificados.
- Homologação real de ponta a ponta (HTTP, conta de teste, confirmação e conciliação em banco de staging) ainda não realizada.
- Produção exige assinatura Ed25519, compartilhamento da chave pública com o provedor e testes de webhook.
- A UI de saque e a migração ainda não foram implantadas.
- Estornos posteriores, monitoramento operacional e verificação financeira/identidade dos beneficiários precisam de processo auditável.

**Nunca liberar produção com base apenas em simulação local e testes sintéticos.**
