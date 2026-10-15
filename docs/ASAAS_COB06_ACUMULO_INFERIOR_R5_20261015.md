# COB-06 — acumulação de comissões abaixo de R$ 5 (decisão aprovada)

**Decisão do proprietário em 15/10/2026.** Escopo restrito à COB-06 da backlog financeira da PR #39. **Estado: regra aprovada; reserva contábil transacional no candidato SQL e pré-validação testadas em PostgreSQL descartável. Emissão Pix, conciliação intercompetências de pagamento/estorno, homologação e liberação continuam pendentes.** Este documento não autoriza alteração em produção, emissão Pix, saque ou merge.

## Regra aprovada

Uma fatura mensal de comissões inferior a **500 centavos** não deve ser cobrada isoladamente no Asaas, aumentada artificialmente até o mínimo, cancelada nem marcada como paga. A dívida continua devida, e os valores de meses posteriores do **mesmo comércio** podem ser somados até atingir pelo menos R$ 5. A composição deve identificar cada competência, pedido, comissão de plataforma e remuneração de motoboy elegível. A cobrança consolidada deve ser única e idempotente.

Exemplo: outubro com R$ 1 e novembro com R$ 4 geram cobrança total de R$ 5, mantendo a origem de R$ 1 e de R$ 4. Outro exemplo: R$ 2 + R$ 2 + R$ 1 em três competências gera uma cobrança total de R$ 5, não três cobranças.

**Encerramento antecipado:** se o comércio solicitar encerramento ainda com menos de R$ 5, suspender novos pedidos, manter a dívida e encaminhar à regularização separada e comprovada; não arquivar definitivamente, inventar pagamento ou extinguir créditos do motoboy.

## Avanço implementado na PR Draft (sem ativação)

- **Ledger de agrupamento privado:** `supabase/production-candidate/03_cob06_acumulo_intercompetencias_preparacao.sql` (commit `9133a344`, ajuste SQL `dfb0806f`) cria `catalogo_asaas_acumulo_lotes` e `catalogo_asaas_acumulo_fontes`. `fechamento_id` é chave primária nas fontes (uma origem não pode pertencer a dois lotes), e `(comercio_id,competencia_corte)` é único nos lotes. As duas tabelas têm RLS e não concedem escrita nem à `service_role`: **nenhum agrupamento real é criado ou emitido por esta versão**.
- **Pré-validação somente leitura:** `catalogo_asaas_previsualizar_acumulo(text,date)` é executável só pela `service_role`; consulta até uma competência, exclui faturas pagas, emitidas, com reserva bancária ou já agrupadas, e compara a soma de `catalogo_fatura_componentes_v2` com cada fechamento. Retorna `pronto_para_preparar=false` quando falta qualquer snapshot, além do resumo financeiro. Não cadastra clientes, cria reserva, chama o Asaas nem quita créditos.
- **Prova automatizada inicial:** `supabase/tests/isolated/asaas-cob06-acumulo-preview-rollback.sql` roda no `catalogo_cob06_ci` da GitHub Actions, após o pacote original das nove fontes, testa cenário R$1+R$4 ainda sem snapshots e exige **negação**, unicidade de vínculos e ausência de resíduos após `ROLLBACK`. O teste estático Node `tests/asaas-cob06-acumulo-r5-preparacao.test.cjs` impede ligações prematuras com emissão de Pix. **Isto não é teste de cobrança real nem prova de agrupamento completo.**
- **Isolamento do pacote original:** a décima fonte é um candidato **separado e inerte**, executado apenas após as nove fontes em PostgreSQL descartável na CI. Não foi anexada ao pacote de produção congelado nem ao runner manual do clone real.

## Reserva do livro implementada (sem integração bancária)

A rotina `catalogo_asaas_reservar_acumulo(text,date)` foi acrescentada apenas ao candidato `03_cob06_acumulo_intercompetencias_preparacao.sql`: usa trava consultiva da mesma loja, `SELECT ... FOR UPDATE` sobre competências elegíveis, compara soma de componentes e fechamento e registra lote e fontes numa única transação. Se ainda não atingir R$5, faltar snapshot ou houver reserva/cobrança anterior, não emite Pix nem inventa quitação. O mesmo corte reaproveita o lote já reservado; uma fonte é única entre lotes.

Triggers candidatos bloqueiam INSERT de cobrança/emissão individual em fontes agrupadas e alterações posteriores de valores/competência do fechamento ou seus componentes. A função é `service_role` exclusiva e a Edge **ainda não a chama**. Nenhum `/payments` foi enviado, nenhum crédito de motoboy foi liberado e não existe função que transforme esses lotes em cobrança bancária.

A GitHub Actions aplica primeiro o pacote congelado de nove SQL em `catalogo_cob06_ci`, depois somente neste banco descartável aplica o SQL candidato 03 e executa os ensaios dentro de `BEGIN/ROLLBACK`. Os cenários sintéticos são **R$1+R$4** e **R$2+R$2+R$1**, além de fonte duplicada, reserva repetida, exclusão/alteração de snapshot, emissão individual proibida e histórico Mercado Pago pago intacto. A primeira CI corrigida passou no cenário R$1+R$4 (run `38777198026`, job de SQL PASS); aprovação dos cenários ampliados depende do run mais recente. **Isto não substitui restauração de backup de produção nem prova de pagamento.**

## Contrato técnico que precisa ser implementado e testado

1. Registrar vínculo durável e único entre fechamento(s) de origem e cobrança consolidada de destino, sem modificar os totais históricos originais; impedir que uma competência já emitida/paga/reservada seja acumulada novamente.
2. Usar bloqueio transacional por comércio e conferir todas as fontes para prevenir dois agrupamentos concorrentes ou dois POSTs Pix após timeout. Cada cobrança deve ter referência externa imutável.
3. Preservar os snapshots `catalogo_fatura_componentes_v2` e demonstrar que a soma das parcelas financeiras vinculadas corresponde exatamente à cobrança. Não usar apenas a soma de `total_comissao_centavos` sem vínculos.
4. Ao conciliar pagamento Asaas, alterar **somente** fechamentos, comissões, remunerações e lançamentos financeiros vinculados, mesmo que sejam de meses diferentes. Nunca liberar 2% do motoboy antes de financiamento e entrega comprovados.
5. Estorno/contestação precisa reverter ou reter **exatamente** o mesmo grupo, com histórico e idempotência. Conferência de dívida e bloqueio de exclusão deve evitar contar duas vezes fechamento original e consolidação.
6. A interface deve mostrar o valor acumulado, meses de origem e estado da cobrança, sem tratar o saldo em espera como pago ou perdoado. A política de faturamento mensal continua vigente, mesmo com emissão bancária diferida.

## Gate seguro em vigor

A Edge `catalogo-asaas-financeiro/index.ts` atualmente retorna HTTP 409 para fechamento inferior a 500 centavos, **antes** de criar cliente, reservar emissão ou emitir Pix. Essa proteção **deve permanecer** até que o mecanismo intercompetências, a conciliação e os testes estejam concluídos. `catalogo_asaas_registrar_fatura` e `catalogo_confirmar_cobranca_fatura` pressupõem vínculo a um fechamento/competência: alterar só o valor da Edge quebra a consistência contábil.

**Aceite exigido antes de liberar no código:** R$1 + R$4; R$2 + R$2 + R$1; valores ainda inferiores ao mínimo; exatamente R$5; cobranças antigas existentes; alteração concorrente; duas tentativas simultâneas; timeout do provedor; webhook duplicado; estorno e contestação; fechamento do comércio com dívida residual; idempotência em clone PostgreSQL isolado com ROLLBACK; e E2E em STAGING. Não utilizar quitações manuais em SQL para simular pagamentos reais.

**Não fazer deploy**, nem mudar o pacote seletivo congelado de nove SQL, até completar a revisão COB-06 e obter autorização específica.
