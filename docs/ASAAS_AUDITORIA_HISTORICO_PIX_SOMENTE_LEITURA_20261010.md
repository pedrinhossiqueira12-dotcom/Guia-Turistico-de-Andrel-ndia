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

## Checklist de liberação

- [ ] CI integralmente verde no commit final.
- [ ] Homologar botão da varredura com resposta Asaas Sandbox controlada, inclusive páginas repetidas, `hasMore=true` no limite e referências iguais com IDs distintos.
- [ ] Revisão independente de acesso admin, logs e exposição de dados.
- [ ] Revisar limites, comportamento de listagem instável e tarifas/rate limits em contato com provedor.
- [ ] Resolver destinatário original e prova bancária independentes.
- [ ] Não alterar produção sem autorização expressa do usuário.
