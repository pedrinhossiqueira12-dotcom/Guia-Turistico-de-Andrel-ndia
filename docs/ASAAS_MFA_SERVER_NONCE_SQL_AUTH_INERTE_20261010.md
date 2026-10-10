# PR #39 / #42 — Contrato de nonce gerado no PostgreSQL e GoTrue (INERTE)

Data: 10/10/2026. Escopo: contrato e testes offline, nenhuma nova implantacao.

## Problema resolvido no contrato

O simulador antigo partia de um nonce existente na intencao, mas a nova
reserva SQL duravel gera esse nonce no servidor. Conectar os dois sem
adaptacao permitiria discordancia sobre a identidade da operacao.

A classe OrquestradorPrechallengeInerte agora modela a ordem correta:

1. Recebe somente contextoId e bearer. Reserva contexto na porta privada
   do PostgreSQL antes de consultar Auth. O banco gera nonce inalteravel.
2. Le snapshot do contexto owner-only: usuario, sessao, TOTP verificado,
   separacao contabil, hash do dossie e expiracao. Revalida a sessao AAL1
   autenticada e a titularidade do fator via backend independente.
3. Solicita challenge Auth no fator original. Antes de disponibilizar
   tentativa ao chamador, grava no banco desafio e tentativa com UNIQUE.
   Nao devolve nonce, challenge_id, fator ou hash ao cliente.
4. No confirmar(), consulta novamente a tentativa no banco (nao utiliza
   Map em memoria), valida sessao e fator originais, consome o desafio
   no banco antes do OTP e somente depois chama Auth verify.
5. Exige que a resposta assinada de Auth seja AAL2 na MESMA sessao com
   o MESMO fator. Todos os retornos continuam com HOLD_OBRIGATORIO;
   autenticar nao e autorizar pagamento.

As flags de parecer, dupla aprovacao, autorizacao Pix, baixa e movimentacao
de dinheiro devem permanecer false inclusive nas respostas do banco.

## Testes

- Contrato e Deno: supabase/functions/_shared/catalogo-asaas-mfa-orquestrador-prechallenge-inerte.ts
- Testes novos: supabase/functions/tests/catalogo-asaas-mfa-orquestrador-prechallenge-inerte.test.ts
- Pipeline: Financial snapshot tests (Deno, isolated) em .github/workflows/database-tests.yml
- PostgreSQL concorrente real separado: scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py

Cenarios: duas instancias, nonce exclusivamente SQL, challenge exclusivo,
replay de OTP bloqueado, fator falso, JWT divergente, sessao AAL2 diferente,
falha do Auth, banco indisponivel, expiracao, SQL que indevidamente libera
dinheiro e recibos adulterados. Nenhum teste acessa rede financeira.

## LIMITES REAIS E PENDENCIAS

- A classe e o livro SQL sao portas INERTES de testes, nao sao um
  endpoint MFA implantado. O livro simulado por Map nao substitui
  o teste de concorrencia verdadeiro de duas conexoes PostgreSQL na CI.
- O PostgreSQL de STAGING tem as funcoes em catalogo_private acessiveis
  apenas ao owner SQL, com EXECUTE revogado para anon, authenticated e
  service_role. Nao conceder acesso via Data API para integrar um Edge.
  Falta desenhar canal backend privado auditado com privilegios minimos.
- Falta inscricao de fatores TOTP reais em STAGING; a ultima auditoria
  encontrou zero fatores TOTP verificados.
- AAL2 de sessao por si nao comprova vinculo de challenge a operacao.
  E obrigatoria uma trilha independente, revisores sem conflito (#43)
  e prova bancaria/titularidade da chave Pix original (#41).
- Nenhum endpoint, secret, migration, webhook, transferencia ou Asaas
  producao foi alterado neste incremento. PR #39 continua Draft/HOLD.

Fontes Supabase:
https://supabase.com/docs/reference/javascript/auth-mfa-challenge
https://supabase.com/docs/reference/javascript/auth-mfa-verify
https://supabase.com/docs/reference/javascript/auth-getclaims
https://supabase.com/docs/guides/auth/auth-mfa
