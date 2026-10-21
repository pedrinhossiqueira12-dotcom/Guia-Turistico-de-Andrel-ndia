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

## Estado

P2–P5 em execucao sequencial. Concorrencia real de multiplas conexoes requer
PostgreSQL descartavel na CI; PGlite sozinho nao comprova essa propriedade.
COB-06 continua HOLD; nenhum candidato autoriza implantacao ou dinheiro.
