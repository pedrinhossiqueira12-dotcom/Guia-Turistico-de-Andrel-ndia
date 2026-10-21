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

## Estado

P3–P5 em execucao sequencial. Concorrencia real de multiplas conexoes requer
PostgreSQL descartavel na CI; PGlite sozinho nao comprova essa propriedade.
COB-06 continua HOLD; nenhum candidato autoriza implantacao ou dinheiro.
