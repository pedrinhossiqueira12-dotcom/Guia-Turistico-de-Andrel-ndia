# Etapa #42 — protocolo de step-up MFA em CI, sem autorização financeira

**10/10/2026 | Guia Andrelândia | PR #39 Draft | protótipo Deno isolado**

## Problema que esta entrega aborda

O Supabase oferece `auth.mfa.challenge({factorId})` e
`auth.mfa.verify({factorId,challengeId,code})` para comprovar o
segundo fator. No entanto, o histórico `auth.mfa_challenges.verified_at`
por si só não identifica a sessão que efetuou a verificação.

Para proteger operações futuras será necessário criar o desafio no backend,
guardar a associação entre seu `challengeId` e a **intenção documental
de uso único**, e revalidar depois da verificação que o token obtido pertence
ao **mesmo usuário, mesma sessão e mesmo fator**.

A verificação do token/sessão precisará ser feita pelo Auth real, e não
pela decodificação sem assinatura de JWT ou por argumentos fornecidos
pelo navegador.

## Implementação desta rodada

- `supabase/functions/_shared/catalogo-asaas-stepup-documental-ensaio.ts`
  contém um **simulador** do protocolo, com portas injetáveis
  (`autenticarToken`, `criarDesafio`, `verificarDesafio`) e armazenamento
  **somente em memória** durante o teste Deno.
- `supabase/functions/tests/catalogo-asaas-stepup-documental-ensaio.test.ts`
  implementa apenas uma **porta Auth falsa**, tokens fictícios e
  timeouts simulados, sem rede e sem contas reais.
- Testes Deno foram incluídos na tarefa `Financial snapshot tests
  (Deno, isolated)` do workflow de CI. `deno check` adicional confere
  os tipos do módulo.
- A classe só aceita `ambiente="isolated-ci"`. Nenhuma Edge Function
  de produção ou rota HTTP importa esse módulo. Não há serviço novo
  nem função Supabase implantada ou permissão SQL concedida.
- O iniciador valida nonce, hash da evidência, sessão, usuário e fator,
  não aceita intenção já consumida/expirada, solicita ao **provider fake**
  um desafio e armazena seu ID **internamente**, com janela de até 120s.
  O cliente só recebe identificador de tentativa.
- O confirmador aceita a tentativa mais código TOTP; ele não aceita
  `challengeId`, `factorId` ou `userId` arbitrário do solicitante.
  Marca a tentativa como em processamento **antes** da chamada assíncrona
  e não permite reaproveitar uma tentativa consumida/recusada.
- Após resposta da porta Auth falsa, uma segunda chamada de
  `autenticarToken` confere que o principal `aal2` retornado
  corresponde ao usuário, sessão e fator originalmente vinculados.
  Qualquer divergência, erro, expiração ou replay é recusado.

## Matriz de testes Deno — somente simulação

1. Desafio válido fictício, ID guardado no servidor, segunda verificação
   Auth fake e resposta com `protocolo_mock_validado=true`, mas HOLD.
2. Nonce consumido, expirado, malformado, finalidade e hash indevidos.
3. Troca do usuário, sessão, fator MFA ou identidade anônima antes do desafio.
4. Duas tentativas de abrir o mesmo nonce ao mesmo tempo.
5. Código OTP malformado impedido antes de chegar ao provedor.
6. Outra sessão tentando confirmar o desafio da primeira.
7. Resposta da porta Auth com usuário, sessão, fator, AAL ou anonimato divergentes.
8. Provedor retornando erro na emissão ou na verificação.
9. Prazo de dois minutos vencido antes de confirmar.
10. Confirmações simultâneas: apenas uma chega ao `verificarDesafio`.

**Mesmo o caminho positivo de laboratório sempre retorna:**

`desafio_mfa_real_comprovado=false`,
`parecer_financeiro_autorizado=false`,
`pagamento_autorizado=false`,
`liberacao_autorizada=false`, `baixa_realizada=false`,
`movimenta_dinheiro=false`,
`status_operacional=HOLD_OBRIGATORIO`.

O sinal `protocolo_mock_validado=true` significa **somente que o fluxo
passou em uma porta Auth falsa**. Não pode ser armazenado como credencial
MFA real, usado para criar parecer ou tratado como autorização.

## Requisitos para implementação futura no Auth verdadeiro

1. Backend próprio com autenticação por token **validada no Supabase**,
   sessão observada no Auth e credenciamento de revisores; não basta
   confiar em claims recebidos do cliente.
2. Vincular `challengeId` emitido pelo backend a `nonce`,
   `session_id`, `user_id`, `factor_id`, escopo da ação e
   fingerprint imutável da evidência, todos conferidos no servidor.
3. Usar `mfa.challenge` e `mfa.verify` do Supabase Auth em um
   fluxo backend com sessão original; depois da verificação conferir
   novamente a identidade e sessão da resposta via serviço Auth.
   Não inferir confirmação do `iat` do token recém-emitido.
4. Persistir tentativas e bloqueio de replay em **transações reais
   compartilhadas pelo cluster**, jamais usar o `Map` em memória
   deste teste. Adicionar limites de tentativas, anti-brute-force,
   logs sem OTP/segredos e proteção contra múltiplas instâncias.
5. Vincular aprovação documental a **revisores humanos independentes**,
   sem permitir que esse resultado acione autorizações financeiras.
   A etapa #41 ainda exige prova bancária externa independente; #43
   exige nova transação de autorização com revisão de privilégios e
   revalidação de destino/valores e duplo controle.
6. Revisar o alerta do Supabase Security Advisor sobre
   `authenticated_security_definer_function_executable` antes de
   expor mais qualquer função sensível.

**Não há integração MFA real, credenciamento de revisores, operação
financeira, migração SQL, deploy de Edge, merge ou alteração em produção
nesta entrega.**

Fontes do contrato: documentação do Supabase Auth
[challenge](https://supabase.com/docs/reference/javascript/auth-mfa-challenge),
[verify](https://supabase.com/docs/reference/javascript/auth-mfa-verify) e
[MFA](https://supabase.com/docs/guides/auth/auth-mfa).
