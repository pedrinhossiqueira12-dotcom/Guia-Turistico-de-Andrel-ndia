# COB-06 — correcoes locais da auditoria independente

Base: `d3c9654`, PR #39 Draft. As cinco prioridades recebidas do proprietario
substituem a conclusao anterior de ausencia de pendencias locais. Sem acesso a
PROD/STAGING, provedor real ou Sandbox. SQLs `cob06-auditoria-*` sao candidatos
forward-only separados: nao alteram as nove fontes/hashes do corte auditado e
exigem revisao explicita antes de compor outro pacote ou serem instalados.

## Resultado final do codigo — 21/10/2026

**Cinco prioridades corrigidas localmente, COB-06 ainda HOLD.** Codigo final
`077e2bccff6007c082dfaf8f2e86eb033f48d93e`:
[CI 39655179890](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/39655179890),
**12/12 jobs PASS**, conferidos individualmente. Regressao local: **983/983 PASS**.
Nenhuma migration historica, fonte SQL congelada ou hash do lock foi alterado;
verificador original novamente aprovado. Nenhum acesso SQL remoto, deploy,
Secret/flag, operacao Asaas real/Sandbox, Pix, transferencia ou merge.

| Prioridade | Commit principal | Evidencia comportamental |
| --- | --- | --- |
| P1 | `66904e1` | Comissao tardia 700 antes ignorada, cobertura parcial, snapshot pago intacto |
| P2 | `4355c7d` | RPC MP nao troca ID Asaas, uma tentativa POST, disputa de duas conexoes e snapshot congelado |
| P3 | `fdfd982` | Pagamento parcial, duas dividas, estorno/quitacao concorrentes, motivos preservados |
| P4 | `2638573` | Arquivo continua na fila ate ACK, falhas GitHub/ACK e retry idempotente |
| P5 | `e2cfc9e` | Pedido antes aceito conclui; novo aceite/pedido, outro titular/motoboy e codigo errado recusados |

Complementos: `b01ff61` (consulta MP historica sem emissao), `043f32c` (ordem de
locks e entrypoints), `a38f72b` (ACL e credito retido), `077e2bc` (sessao na UI).
Todas as reproducoes principais falharam antes das respectivas correcoes e
passaram depois. Provedores sao falsos; PostgreSQL/PGlite usa dados sinteticos.

O log financeiro final confirma os marcadores `COB06_AUDITORIA_P2_RESERVA_COMUM_DUAS_CONEXOES_OK`,
`COB06_AUDITORIA_P2_SNAPSHOT_RESERVADO_CONGELADO_OK`,
`COB06_AUDITORIA_P3_QUITACAO_ESTORNO_SERIALIZADOS_OK`,
`COB06_AUDITORIA_REGISTRO_CONCILIACAO_SEM_CICLO_DE_LOCK_OK` e
`COB06_AUDITORIA_CINCO_CANDIDATOS_FORWARD_ONLY_INSTALADOS_NO_CLONE_OK`.

### Pendencias efetivas

1. Revisao explicita de um NOVO corte com os cinco candidatos e dependencias;
   o ZIP de nove SQLs permanece apenas revisao e nao instala estas correcoes.
2. Comparar assinaturas/definicoes/ACL reais antes de qualquer instalacao futura
   autorizada. Os wrappers preservam funcoes existentes e restringem seus nomes
   internos; nao instalar/reaplicar indiscriminadamente ou atualizar hashes antigos.
3. Suspensoes historicas sem data comprovavel exigem revisao por operador; nao
   inventar data retroativa. Bloqueios administrativos continuam fechados.
4. Homologacao operacional e revisao independente, recuperacao funcional/off-host
   e autorizacao especifica de COB-07/08. Os testes nao comprovam Asaas/MP reais,
   secrets, elegibilidade comercial nem equivalencia integral de PROD/STAGING.

Nao repetir GET/reserva no lote QA historico. SAQ continua fora da fase atual.
O registro documental posterior a este resultado nao modifica o codigo validado.

## P1 — divida fora do snapshot

- Reproducao PostgreSQL embarcado PGlite com migrations reais: comissao tardia
  de 700 centavos na competencia paga retornava zero (`0 != 700`).
- Candidato 01 soma a parte da comissao nao coberta por componentes reais da
  mesma origem. Testa cobertura parcial, cancelamento e fatura paga inalterada.
- 13/13 testes direcionados passaram, incluindo guardas de encerramento e
  integridade das nove fontes congeladas. Sem alteracao de dados remotos.

## P2 — exclusao mutua entre provedores

- Reproducao SQL: a RPC MP substituia ID de Asaas (`true != false`).
- Candidato 02 amplia o journal existente com gateway, trava de fechamento,
  reserva permanente compartilhada e identidade bancaria imutavel. Backend MP
  exige recibo novo antes do POST; Asaas participa pelo trigger da reserva que
  ja executa antes de clientes/payments. Repeticao/timeout nao libera novo POST.
- Snapshot total/componentes fica congelado apos reservar. Cobranças historicas
  continuam consultaveis no provedor original; endpoints MP recusam gateway alheio.
- SQL e emissao MP real em VM + provedor falso: duas requisicoes geram um POST.
  9/9 testes com regressao de integracao passaram. Ensaio de duas conexoes
  PostgreSQL integrado a CI; resultado ainda pendente. Nove fontes preservadas.

## P3 — bloqueio enquanto houver obrigacoes vencidas

- Reproducao: pagar uma de duas faturas vencidas desbloqueava a loja.
- Candidato 03 envolve a funcao ja instalada, preserva sua logica contabil,
  serializa conciliacoes por loja antes de bloquear cobrancas e reapura faturas
  vencidas e comissoes vencidas fora do snapshot. Preserva motivos administrativos
  e de encerramento; recebimento atrasado nao reativa estorno/contestacao.
- Teste SQL comportamental aprovado: valor parcial, quitacao de uma e depois
  ambas, estorno, replay e motivos nao financeiros. Corrida de duas conexoes
  quitacao versus estorno incluida na CI, resultado ainda por verificar.

## P4 — reconciliacao da vitrine depois de arquivar

- Reproducao: a listagem removia todo `arquivado`, inclusive sem GitHub confirmado.
- Candidato 04 cria journal privado, preenchido na mesma transacao do arquivo
  (com e sem catalogo). Fila inclui arquivos sem ACK; somente a Edge administrativa
  confirma apos sucesso GitHub. Perda do ACK permanece reconciliavel; retry nao
  reabre arquivo nem faz PUT redundante. UI identifica a reconciliacao pendente.
- 25/25 testes SQL/HTTP direcionados passaram: perda da fila, RPC financeira real,
  autorizacao, idempotencia, GitHub/ACK falhos e arquivo preservado.

## P5 — continuacao de pedidos anteriores a suspensao

- Reproducao HTTP/SQL: pedido aceito era impedido de ficar pronto por 423.
- Candidato 05 registra o instante de novas suspensoes e envolve as RPCs de
  operacao/confirmacao, mantendo a implementacao original de titularidade,
  transicoes, codigo, entrega e financiamento. Novo aceite continua proibido.
- Pedidos aceitos antes da suspensao financeira/encerramento podem continuar;
  bloqueio administrativo continua fechado. Historico usa solicitado_em do
  encerramento quando existente; suspensao antiga sem marco confiavel fica HOLD,
  sem preencher data artificialmente. Trava NOWAIT evita espera circular com
  transacoes legadas que ja bloquearam o pedido.
- Painel suspenso mostra pedidos sem habilitar produtos/configuracao nem novos
  aceites. Testes de codigo errado, titular alheio, novo aceite, entrega com
  pagamento e preservacao da suspensao passaram; regressao completa pendente.

## Estado

Investigacao adicional reproduziu a consulta MP enviada indevidamente a Edge Asaas.
O painel agora identifica o gateway por leitura autenticada e delega **somente a
consulta/conciliacao** ao endpoint MP original, normalizando a resposta. Nunca ha
fallback de emissao. Testes verificam falha de identificacao, Asaas preservado e
consulta de legado MP com emissao desligada, usando somente GET ficticio.
O congelamento do snapshot apos reserva trata corrida emissao/fechamento; eventos
financeiros por loja sao serializados e recebimento tardio nao desfaz estorno.
O ZIP antigo continua com nove SQLs; agora alerta que o runtime candidato depende
das cinco correcoes externas ao corte, que exigem revisao explicita separada.
Investigacao da ordem de locks encontrou ainda potencial ciclo entre registro
(fechamento -> cobranca) e conciliacao. O candidato 03 agora usa loja -> fechamento
-> cobranca, compativel com os registradores. Nova corrida real na CI reproduz
as duas ordens sem abrir rede e exige conclusao sem deadlock. O candidato 05
protege INSERT/aceite tambem por trigger, cobrindo entrypoints legados.

Primeira CI das cinco correcoes (`e2cfc9e`): run **39653830450, 12/12 PASS**.
Log confirmou `COB06_AUDITORIA_P2_RESERVA_COMUM_DUAS_CONEXOES_OK`,
`COB06_AUDITORIA_P3_QUITACAO_ESTORNO_SERIALIZADOS_OK` e instalacao dos cinco
candidatos no clone. Regressao local apos consulta MP: **981/981 PASS**.
As protecoes adicionais de snapshot/ordem de locks/entrypoints exigem a proxima
CI; a primeira nao as valida retroativamente.

## Cobertura final adicionada

Os 12 testes de auditoria/historico passaram localmente. Consultas reais de ACL
no PostgreSQL confirmam que funcoes pre-auditoria nao continuam acessiveis a
service_role e que anon/authenticated nao recebem os novos privilegios internos.
Entrega por motoboy apos suspensao foi executada pelas RPCs reais: outro entregador
e recusado e a remuneracao continua retida/sem financiamento antes da fatura.

Commits por prioridade: P1 `66904e1`, P2 `4355c7d`, P3 `fdfd982`, P4 `2638573`,
P5 `e2cfc9e`; complementos `b01ff61` (historico MP) e `043f32c` (locks e legado).
O proximo commit acrescenta apenas cobertura/evidencias. Nenhuma alteracao remota
ou no manifesto/hash dos nove SQLs. Suspensoes historicas sem marco e aprovacao
do novo corte permanecem bloqueios explicitos, sem datas/provas inventadas.

Revisao da UI suspensa adicionou prova de isolamento de sessao: o card de pedidos
e limpo/ocultado antes de revalidar titularidade e so reaparece apos autorizacao.
O teste reproduziu dados anteriores visiveis sem sessao e agora passa para
sessao ausente e titularidade negada. E um complemento de P5, sem novo fluxo.

Cinco correcoes locais implementadas; regressao e CI em andamento. Concorrencia real de multiplas conexoes requer
PostgreSQL descartavel na CI; PGlite sozinho nao comprova essa propriedade.
COB-06 continua HOLD; nenhum candidato autoriza implantacao ou dinheiro.
