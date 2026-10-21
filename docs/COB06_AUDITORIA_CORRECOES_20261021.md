# COB-06 — correcoes locais da auditoria independente

Base: `d3c9654`, PR #39 Draft. As cinco prioridades recebidas do proprietario
substituem a conclusao anterior de ausencia de pendencias locais. Sem acesso a
PROD/STAGING, provedor real ou Sandbox. SQLs `cob06-auditoria-*` sao candidatos
forward-only separados: nao alteram as nove fontes/hashes do corte auditado e
exigem revisao explicita antes de compor outro pacote ou serem instalados.

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

Cinco correcoes locais implementadas; regressao e CI em andamento. Concorrencia real de multiplas conexoes requer
PostgreSQL descartavel na CI; PGlite sozinho nao comprova essa propriedade.
COB-06 continua HOLD; nenhum candidato autoriza implantacao ou dinheiro.
