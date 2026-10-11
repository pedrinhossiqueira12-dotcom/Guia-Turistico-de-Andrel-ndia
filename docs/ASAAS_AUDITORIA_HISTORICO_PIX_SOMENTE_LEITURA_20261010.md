# Auditoria de histórico Asaas Sandbox — etapa #41 (10/10/2026)

**Escopo:** PR #39 (Draft), Supabase STAGING / testes isolados. **Nunca produção.**
**Estado:** implementação em branch, sem deploy da Edge; validação integrada pendente.
**Responsabilidade:** prevenção de conciliação financeira falsa de créditos de motoboys.

## Fontes oficiais e limites

- Consulta individual: [GET /v3/transfers/{id}](https://docs.asaas.com/reference/recuperar-uma-unica-transferencia).
- Busca paginada: [GET /v3/transfers](https://docs.asaas.com/reference/listar-transferencias).
- Paginação: [limit, offset e hasMore](https://docs.asaas.com/reference/listagem-e-paginacao).
- O Asaas recomenda webhooks para acompanhar mudanças de estado; uma leitura pontual não é garantia de estado final.
- A documentação de criação distingue destino via `pixAddressKey` de `bankAccount`. **Não presumir que o GET garante titularidade original, identidade completa do beneficiário ou prova de liquidação.** [Transferências Pix/TED](https://docs.asaas.com/docs/transferencia-para-contas-de-outra-instituicao-pix-ted).

## Implementado nesta branch

- Ação `auditar_historico_transferencias_excepcionais_sandbox_admin` na Edge financeira, autorizada somente para admin com `ASAAS_ENVIRONMENT=sandbox`.
- Exige separação `congelada` existente; compara `tipo`, `solicitacao_id`, referência esperada `guia-exc:<tipo>:<uuid>`, valor e ID de transferência vinculado ao pedido.
- Realiza **apenas GET** paginado no Asaas (100 registros por página, máximo de 12 páginas por clique) e compara referências repetidas, IDs de transferências distintos, valor divergente, ID ligado também a saque comum e situação de DONE.
- Consulta o vínculo local e dados mínimos; **não retorna nem registra** chave Pix, CPF, agência, conta, payload completo ou identificadores de outros destinatários.
- Resposta de paginação inválida, banco indisponível ou registro de separação ausente: **erro e HOLD**. Ao atingir o limite da busca, retorna explicitamente `listagem_consultada_ate_o_fim=false`.
- Painel `admin-encerramentos`: botão **Verificar transferências repetidas (Sandbox)**, com alertas. Não existe botão de pagamento, quitação ou liberação.
- Testes de contrato: `tests/catalogo-asaas-varredura-historico.test.cjs`; execução Deno/Node/Chromium/SQL pela CI existente.

## Endurecimento de paginação em 11/10/2026

A API oficial do Asaas documenta o retorno de `limit`, `offset`,
`totalCount`, `hasMore` e `data` em `GET /v3/transfers`.
O auditor verificava `hasMore` e offset, mas não exigia `limit`
nem `totalCount` válidos. Uma página com 40 itens e `hasMore=true`
poderia ser seguida de `offset=100`, pulando até 60 itens.

**Agora, se os campos de paginação estiverem faltando, forem inválidos
ou indicarem página parcial com `hasMore=true`, a Edge responde 503
e preserva HOLD.** Confere adicionalmente que `totalCount` não é
inferior a `offset + data.length`.

- `limit` deve ser exatamente 100 e `offset` o esperado pela varredura;
- `totalCount` deve ser inteiro não negativo;
- `hasMore=true` exige exatamente 100 itens e `totalCount > offset + data.length`;
- `hasMore=false` só encerra quando `totalCount === offset + data.length`;
- falha ou contradição nunca produz auditoria marcada como concluída;
- Deno testa a Edge HTTP real com Asaas/Supabase *fictícios* e rede externa bloqueada;
- Node vigia o contrato estático para evitar regressões.

Esses controles **não convertem uma listagem mutável em extrato
bancário definitivo**: uma transferência inserida ou removida entre
páginas pode causar instabilidade mesmo com metadados consistentes.
Nenhuma ausência de pagamento ou titularidade é atestada. Não houve
deploy da Edge nem migração de banco nesta alteração.

Referências:
- https://docs.asaas.com/reference/listagem-e-paginacao
- https://docs.asaas.com/reference/listar-transferencias

## Regra de totalCount entre páginas — 11/10/2026

A auditoria exige que o `totalCount` retornado pelo Asaas seja igual
em todas as páginas. Se variar, responde HTTP 503 e mantém HOLD, mesmo
quando os metadados de cada página forem individualmente consistentes.
Teste isolado: `totalCount=101` na primeira página e `102` na
segunda. Isso não habilita transferência, baixa nem pagamento.

A verificação reduz falsos relatórios causados por histórico mutável,
mas **não cria um snapshot bancário atômico**. Uma inserção e uma
exclusão simultâneas podem manter a mesma contagem. A titularidade
original e a ausência independente de Pix anterior continuam sem prova.

## Conflitos entre referências excepcionais e saques comuns — 11/10/2026

A consulta de saques comuns verificava antes somente o `transferencia_id`
já associado ao vínculo excepcional local. Agora **todos os IDs distintos**
retornados pelo Asaas **com a referência da separação consultada** são
conferidos também no histórico local de saques comuns. Isso cobre inclusive
uma referência excepcional cujo vínculo ainda não existe, mas cujo ID do
banco já foi utilizado em saque ordinário.

- As verificações são feitas por `SELECT` em lotes de até 40 IDs, somente
  no backend administrativo. A consulta aceita no máximo 400 IDs distintos;
  volume maior retorna HTTP 503, com investigação manual e HOLD.
- Falha no banco ou resposta inconsistente aborta o relatório; não existe
  interpretação permissiva na indisponibilidade.
- O painel exibe apenas **quantos IDs bancários coincidiram** com saques
  comuns, nunca os IDs, chaves Pix, contas ou documentos.
- Testes da Edge com Asaas e Supabase fictícios verificam conflito mesmo
  sem vínculo excepcional local e mantêm todas as flags financeiras falsas.

Esse cotejo revela possíveis reutilizações **dentro dos registros disponíveis
na conta e banco consultados**, não comprova a inexistência de transferência
anterior, a identidade do destinatário ou que o mesmo ID represente
liquidação efetiva. Não configura reembolso, quitação ou liberação.
**Nenhuma migração, deploy de Edge, Pix ou mudança em produção.**

## O que esta auditoria NÃO garante

1. `listagem_consultada_ate_o_fim=true` só significa que o endpoint devolveu `hasMore=false` nessa consulta **àquela conta Asaas**. Não há atestado de outras contas, histórico deletado/fora de banda, ou transferência de referência diferente.
2. Paginação com resultados alterados durante a varredura pode pular/repetir itens. A listagem não é uma fotografia bancária imutável.
3. Mesmo `DONE`, referência igual, valor correto e ID único **não comprovam que o dinheiro chegou ao destinatário original**.
4. Uma chave Pix atual no cadastro do motoboy pode ser diferente da chave na data da solicitação. Não reutilizá-la como prova retrospectiva.
5. Sem prova original de destino, ausência independente de pagamento anterior e confirmação junto ao provedor, todo crédito mantém HOLD. O código sempre devolve `pagamento_autorizado=false`, `baixa_realizada=false` e `ausencia_de_pix_anterior_comprovada=false`.
6. O escopo **não** inclui fazer POST /transfers, criar webhooks, alterar escrows, marcar comissões como pagas ou autorizar produção.

## Próxima implementação bloqueada por prova externa

Para atestar o destinatário original sem improvisar:
- Definir e revisar **como a origem mantém o destino imutável ANTES de qualquer transferência** (sem permitir preenchimento retroativo com chave atual).
- Preservar em ambiente privado um compromisso verificável dos dados do pedido/beneficiário com chave HMAC protegida e trilha de auditoria; evitar SHA-256 simples de dados pessoais de baixa entropia.
- Confirmar **com a documentação e com a conta Asaas autorizada** quais campos efetivos do GET/webhook/extrato comprovam destino, titular e liquidação — e a abrangência dos históricos de transferência.
- Projetar um mecanismo bancário independente ou conciliação manual com dupla conferência que possa rejeitar fatos ausentes ou contraditórios sem liberar saldo; só depois propor migração de baixa/liquidação sujeita a autorização específica.


## Deteccao de ID bancario com referencias externas divergentes — 11/10/2026

- Durante as paginas de **GET somente leitura** no Sandbox, o scanner acompanha a primeira `externalReference` observada para cada ID e identifica IDs que aparecem depois com referencia diferente (inclusive quando a referencia alheia aparece **antes** da referencia da separacao).
- Para cada ID encontrado com a referencia da separacao examinada, a nova contagem `ids_da_referencia_com_outra_referencia` sinaliza a colisao. Funciona **sem vinculo excepcional local** e **sem saque comum** no banco do Guia; o painel exibe apenas a quantidade, nunca o ID ou dados bancarios.
- Mesmo que duas paginas informem o mesmo `totalCount`, a listagem pode nao ser snapshot imutavel. A colisao e um alerta de anomalia, nao prova conclusiva de fraude ou de duas transferencias reais.
- Teste HTTP isolado: ID igual sob duas referencias, vinculo local ausente, nenhuma linha de saque comum, `conflito_identificado=true`, todas as flags de pagamento/liberacao/baixa `false`, sem expor CPF ou ID.
- **Inalterado:** `HOLD_OBRIGATORIO`; PR #39 Draft, sem Edge financeira publicada, sem Pix, sem alteracao em STAGING/PROD nem autorizacao financeira.

## IDs repetidos globalmente em paginas diferentes — 11/10/2026

- A contagem de IDs repetidos antes observava apenas as transferencias com a referencia da separacao. Se outra transferencia se repetisse em paginas diferentes (com `totalCount` inalterado), o relatorio nao destacava a instabilidade.
- O scanner agora rastreia **todos os IDs** da listagem de ate 12 paginas e conta em `ids_repetidos_globais` cada ID que apareca mais de uma vez; `conflito_identificado=true` mesmo com **zero referencias da separacao**.
- O painel informa somente a quantidade, sem mostrar IDs, payload bancario ou chave Pix. A contagem anterior `ids_repetidos_na_listagem` permanece especifica da referencia pesquisada.
- Teste Deno executa o handler HTTP real com Sandbox e Supabase simulados e rede externa bloqueada: primeira pagina com 100 itens, ultima com um ID repetido nao relacionado; ambas apresentam `totalCount=101`. A varredura sinaliza conflito e preserva todas as flags financeiras falsas.
- A duplicidade e um **indicio de listagem instavel**, nao prova de fraude ou de transferencia duplicada; sua ausencia tambem NAO atesta integridade temporal, destino ou ausencia de pagamento. `listagem_consultada_ate_o_fim=true` permanece descritivo do endpoint, nao atestado bancario independente.
- Sem POST, migracoes, implantacao Edge, Pix ou alteracao produtiva. PR #39 Draft e `HOLD_OBRIGATORIO`.

## IDs bancarios ausentes ou malformados no lote inteiro — 11/10/2026

- Antes deste incremento, uma transferencia **fora** da referencia investigada podia ser ignorada mesmo quando o GET do Asaas trazia `id` ausente, numero em vez de string, string vazia ou espacos externos. Assim, o painel nao sinalizava a inconsistencia geral da amostra.
- A contagem `ids_sem_identificador_globais` agora cobre todas as paginas examinadas. Se maior que zero, `conflito_identificado=true` e a interface comunica apenas a contagem. O scanner nao aceita um ID com espacos externos como um ID bancario confiavel.
- Teste HTTP Deno da Edge real em rede bloqueada (Asaas e Supabase falsos) com 3 registros nao relacionados, sendo dois com IDs invalidos. Verifica alerta mesmo com nenhuma referencia encontrada, e que todas as flags de autorizacao, pagamento, baixa e evidencia independente permanecem falsas.
- **Importante:** o alerta indica resposta incompleta/inesperada e exige investigacao; nao afirma fraude, pagamento, nao pagamento ou titularidade. `listagem_consultada_ate_o_fim` apenas relata a paginacao; nao atesta integridade ou snapshot bancario.
- Nenhuma implantacao, migracao, POST de Pix ou mudanca no ambiente de producao. PR #39 continua Draft e `HOLD_OBRIGATORIO`.

## Checklist de liberação

- [ ] CI integralmente verde no commit final.
- [ ] Homologar botão da varredura com resposta Asaas Sandbox controlada, inclusive páginas repetidas, `hasMore=true` no limite e referências iguais com IDs distintos.
- [ ] Revisão independente de acesso admin, logs e exposição de dados.
- [ ] Revisar limites, comportamento de listagem instável e tarifas/rate limits em contato com provedor.
- [ ] Resolver destinatário original e prova bancária independentes.
- [ ] Não alterar produção sem autorização expressa do usuário.
