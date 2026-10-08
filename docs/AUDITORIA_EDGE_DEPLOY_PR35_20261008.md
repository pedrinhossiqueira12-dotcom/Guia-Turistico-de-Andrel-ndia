# Auditoria de divergências de funções Edge — PR #35

**Data:** 08/10/2026. Auditoria **somente leitura**, comparando os arquivos da branch
`logic/finalizacao-marketplace-2026-10-07` aos arquivos realmente retornados
pela API de funções Edge do projeto Supabase de produção. Não houve deploy,
alteração de secrets, transferência ou pagamento.

## Entrypoints comparados

| Edge Function | Versão no projeto | Arquivo index.ts igual ao PR? |
| --- | ---: | :---: |
| catalogo-admin | 52 | Sim |
| catalogo-pedido-pix | 33 | Sim |
| catalogo-pedido-offline | 43 | **Não** |
| catalogo-entregas | 8 | Sim |
| catalogo-pedidos-offline-admin | 31 | Sim |
| catalogo-fatura-pix | 8 | Sim |
| mercadopago-marketplace-webhook | 35 | **Não** |
| catalogo-pix-producao | 52 | **Não** |
| mercadopago-oauth-callback | 36 | **Não** |

**Dependências de execução divergentes**, apesar de em alguns casos o
`index.ts` ser igual:
- `_shared/catalogo-pagamentos-v2.ts` — bundle implantado em
  `catalogo-pedido-pix`, `catalogo-pedido-offline` e
  `mercadopago-marketplace-webhook`;
- `catalogo-fatura-pix/fatura-utils.mjs`;
- `catalogo-pix-producao/mercadopago-utils.mjs`.

**Dependências comparadas e idênticas:**
`_shared/catalogo-pedido-offline-runtime.ts` e
`_shared/catalogo-entregas-crypto-v2.ts`.

A função `catalogo-pix-sandbox` e as funções editoriais
não foram comparadas nesta auditoria. Valores exibidos são
instantâneo histórico, sujeitos a novas implantações.

## Interpretação

A divergência é de **código** em alguns arquivos, não apenas do timestamp
do deploy. Parte das diferenças de `index.ts` pode consistir em imports,
formatação ou extração de helpers; a equivalência comportamental completa
não foi comprovada. Por isso, **não deduzir** que os fluxos reais de Pix,
webhook e faturas já executam todas as correções do PR.

O webhook publicado possui funções auxiliares integradas no `index.ts`;
a branch importa `_shared/catalogo-webhook-events.ts`. Publicar somente
o `index.ts` sem resolver e incluir este módulo poderá quebrar o webhook.

## Portas de homologação antes de uma publicação

1. Criar backup real e testá-lo em ambiente isolado.
2. Validar o pacote de migrações e a alteração financeira de 7% sem
   regravar pedidos antigos; revisar dependências de `pg_cron`.
3. Obter a lista de arquivos e imports de cada Edge Function e publicar
   o **bundle coerente**, nunca misturar entrypoint novo com shared antigo.
4. Validar o webhook no ambiente de teste com evento assinado,
   status, idempotência, refund/chargeback e ordem de notificações.
5. Testar checkout Pix, presencial, fatura, aceite do motoboy e reoferta,
   com dados e contas **sintéticos**, sem tokens produtivos ou cobranças reais.
6. Só após autorização explícita do proprietário: decidir ordem
   migrations → funções → frontend, com rollback/monitoramento.

**Status:** bloqueio de prontidão para produção até as verificações externas.
Os testes locais e mocks não comprovam equivalência do código atualmente implantado.
